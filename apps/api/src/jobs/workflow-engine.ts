import {
  DOMAIN_EVENT_PAYLOADS,
  NOTIFICATION_ENTITY_TYPES,
  WORKFLOW_MAX_MATCHES_PER_EVENT,
  conditionsMatch,
  renderTemplate,
  type DomainEventType,
  type WorkflowAction,
  type WorkflowCondition,
  type WorkflowRecipient,
  type WorkflowRunStep,
} from '@ishan/contracts';
import type { PrismaService } from '../infra/prisma.service';
import { activitySearchText } from '../modules/activities/mappers';
import { queueNotificationEmail } from '../modules/notifications/email-outbox';
import type { DispatchedEvent, EventHandler } from './events';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/** The workflow's configuration points at a user who can no longer act; reported, not retried. */
class UserProblem extends Error {}

/** An action that cannot be carried out (e.g. its creator was disabled); the run is recorded as FAILED. */
class ActionFailure extends Error {
  constructor(
    message: string,
    readonly steps: WorkflowRunStep[],
  ) {
    super(message);
  }
}

type Db = Pick<
  PrismaService,
  'user' | 'notification' | 'activity' | 'workflowRun' | 'notificationPreference' | 'emailDelivery'
>;
export interface WorkflowEngineDeps {
  prisma: Pick<PrismaService, '$transaction' | 'workflow' | 'workflowRun'>;
  now?: () => Date;
  /** SMTP is configured: opted-in recipients also get an e-mail copy (ADR 0013). */
  emailChannel?: boolean;
  log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void };
}

interface WorkflowRecord {
  id: string;
  organizationId: string;
  name: string;
  createdById: string;
  conditions: unknown;
  actions: unknown;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Executes the actions of one matched workflow for one event, atomically: the run row (unique per
 * workflow and event) and every notification/task it creates commit together, so a redelivered
 * event can never produce duplicates, and a failing action leaves no half-done work behind.
 * Actions run under the system identity of the workflow, never the user who caused the event.
 */
async function executeActions(
  db: Db,
  wf: WorkflowRecord,
  event: DispatchedEvent,
  payload: Record<string, unknown>,
  runId: string,
  now: Date,
  emailChannel: boolean,
): Promise<WorkflowRunStep[]> {
  const type = event.type as DomainEventType;
  const steps: WorkflowRunStep[] = [];
  const activeUser = async (userId: string) =>
    (await db.user.findFirst({
      where: { id: userId, organizationId: wf.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    })) !== null;

  /** `owner`/`actor` that are missing or inactive are skipped; an explicit user must be valid. */
  const resolve = async (to: WorkflowRecipient): Promise<{ userId?: string; note?: string }> => {
    if (typeof to === 'object') {
      if (!(await activeUser(to.userId)))
        throw new UserProblem('کاربر مقصد فعال نیست یا در این سازمان وجود ندارد');
      return { userId: to.userId };
    }
    const candidate =
      to === 'actor'
        ? event.actorId
        : ((payload.ownerId ?? payload.assigneeId ?? null) as string | null);
    if (!candidate) return { note: to === 'actor' ? 'رویداد کنشگر ندارد' : 'رویداد مالک ندارد' };
    if (!(await activeUser(candidate))) return { note: 'کاربر مقصد غیرفعال است' };
    return { userId: candidate };
  };

  for (const action of wf.actions as WorkflowAction[]) {
    try {
      if (action.type === 'notify') {
        const target = await resolve(action.to);
        if (!target.userId) {
          steps.push({ action: 'notify', status: 'skipped', note: target.note });
          continue;
        }
        const entityType = (NOTIFICATION_ENTITY_TYPES as readonly string[]).includes(
          event.entityType,
        )
          ? event.entityType
          : null;
        const created = await db.notification.create({
          data: {
            userId: target.userId,
            type: 'workflow',
            title: (renderTemplate(action.title, type, payload).trim() || wf.name).slice(0, 200),
            body: action.body ? renderTemplate(action.body, type, payload).slice(0, 1000) : null,
            entityType,
            entityId: entityType ? event.entityId : null,
            workflowRunId: runId,
          },
          select: { id: true },
        });
        if (emailChannel) {
          await queueNotificationEmail(db, { id: created.id, userId: target.userId }, now);
        }
        steps.push({ action: 'notify', status: 'done', createdId: created.id });
      } else {
        if (!(await activeUser(wf.createdById))) {
          throw new UserProblem('سازنده‌ی گردش‌کار غیرفعال یا حذف شده است');
        }
        const target = await resolve(action.assignee);
        if (!target.userId) {
          steps.push({ action: 'create_task', status: 'skipped', note: target.note });
          continue;
        }
        const title = (renderTemplate(action.title, type, payload).trim() || wf.name).slice(0, 200);
        const customerId =
          (payload.customerId as string | null | undefined) ??
          (event.entityType === 'customer' ? event.entityId : null);
        const dealId =
          (payload.dealId as string | null | undefined) ??
          (event.entityType === 'deal' ? event.entityId : null);
        const created = await db.activity.create({
          data: {
            organizationId: wf.organizationId,
            type: 'TASK',
            status: 'PLANNED',
            priority: action.priority,
            title,
            dueAt: new Date(now.getTime() + action.dueInDays * DAY_MS),
            assigneeId: target.userId,
            createdById: wf.createdById,
            customerId: customerId ?? null,
            dealId: dealId ?? null,
            searchText: activitySearchText({ title }),
          },
          select: { id: true },
        });
        steps.push({ action: 'create_task', status: 'done', createdId: created.id });
      }
    } catch (e) {
      // Anything but a known configuration problem (database down, bug) must bubble up and retry.
      if (!(e instanceof UserProblem)) throw e;
      const message = e.message;
      steps.push({ action: action.type, status: 'failed', note: message.slice(0, 200) });
      throw new ActionFailure(message, steps);
    }
  }
  return steps;
}

export type RunOutcome = 'succeeded' | 'failed' | 'duplicate';

export async function runWorkflow(
  deps: WorkflowEngineDeps,
  wf: WorkflowRecord,
  event: DispatchedEvent,
  payload: Record<string, unknown>,
): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  try {
    await deps.prisma.$transaction(async (tx) => {
      // The unique (workflow_id, event_id) insert is the idempotency gate: a second delivery
      // fails here and rolls back before any action ran.
      const run = await tx.workflowRun.create({
        data: {
          workflowId: wf.id,
          eventId: event.id,
          status: 'SUCCEEDED',
          startedAt,
          finishedAt: startedAt,
          steps: [],
        },
        select: { id: true },
      });
      const steps = await executeActions(
        tx as unknown as Db,
        wf,
        event,
        payload,
        run.id,
        startedAt,
        deps.emailChannel ?? false,
      );
      await tx.workflowRun.update({
        where: { id: run.id },
        data: { steps: steps as never, finishedAt: now() },
      });
    });
    return 'succeeded';
  } catch (e) {
    if (isUniqueViolation(e)) return 'duplicate';
    if (!(e instanceof ActionFailure)) throw e;
    try {
      await deps.prisma.workflowRun.create({
        data: {
          workflowId: wf.id,
          eventId: event.id,
          status: 'FAILED',
          startedAt,
          finishedAt: now(),
          steps: e.steps as never,
          error: e.message.slice(0, MAX_ERROR_LENGTH),
        },
      });
    } catch (inner) {
      if (!isUniqueViolation(inner)) throw inner;
    }
    deps.log?.error(
      { workflowId: wf.id, eventId: event.id, error: e.message },
      'workflow run failed',
    );
    return 'failed';
  }
}

/**
 * Event handler: finds the enabled workflows of the organization for this event type, keeps those
 * whose conditions hold (at most 20) and runs them. Events caused by a workflow never trigger
 * workflows, so chains and loops are impossible in v1. One workflow failing never blocks the
 * others; an unexpected error (database down) is rethrown at the end so the job is retried, which
 * is safe because every run is idempotent.
 */
export function createWorkflowHandler(deps: WorkflowEngineDeps): EventHandler {
  return async (event) => {
    if (event.causedByRunId) return;
    const schema = DOMAIN_EVENT_PAYLOADS[event.type as DomainEventType];
    if (!schema) return;
    const parsed = schema.safeParse(event.payload);
    if (!parsed.success) {
      deps.log?.error({ eventId: event.id, type: event.type }, 'event payload is invalid; skipped');
      return;
    }
    const payload = asRecord(parsed.data);
    const workflows = await deps.prisma.workflow.findMany({
      where: {
        organizationId: event.organizationId,
        triggerType: event.type,
        enabled: true,
        deletedAt: null,
      },
      orderBy: { id: 'asc' },
      take: 50,
    });
    const matched = workflows
      .filter((w) => conditionsMatch(w.conditions as WorkflowCondition[], payload))
      .slice(0, WORKFLOW_MAX_MATCHES_PER_EVENT);
    let unexpected: unknown;
    for (const wf of matched) {
      try {
        await runWorkflow(deps, wf, event, payload);
      } catch (e) {
        unexpected ??= e;
      }
    }
    if (unexpected) throw unexpected;
  };
}
