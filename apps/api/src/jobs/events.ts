import type { Job } from 'bullmq';
import { CONTRACT_EXPIRY_WINDOW_DAYS } from '@ishan/contracts';
import type { PrismaService } from '../infra/prisma.service';
import { EVENT_JOBS } from '../infra/queue/queues';
import { buildEventRow } from '../modules/events/domain-events.service';
import { contractNumber, tehranToday } from '../modules/quotes/mappers';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Events younger than this are left to the normal path; the sweeper only rescues stragglers. */
export const SWEEP_MIN_AGE_MS = 30_000;
/** An event that failed this many times stops being retried (poison guard); it stays in the table. */
export const MAX_DISPATCH_ATTEMPTS = 10;
const SWEEP_BATCH = 500;
/** First run after enabling the feature must not flood users with ancient overdue tasks. */
const OVERDUE_LOOKBACK_DAYS = 7;

export interface DispatchedEvent {
  id: string;
  organizationId: string;
  type: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  payload: unknown;
  causedByRunId: string | null;
  occurredAt: Date;
}

/** Handlers must be idempotent: a retry re-runs every handler for the same event. */
export type EventHandler = (event: DispatchedEvent) => Promise<void>;

export interface EventsDeps {
  prisma: Pick<PrismaService, 'domainEvent'>;
  handlers: EventHandler[];
  now?: () => Date;
  log?: { info: (obj: object, msg: string) => void };
}

/** Processor of the `events` queue: run every handler, then stamp `dispatched_at`. */
export function createEventsProcessor(deps: EventsDeps) {
  return async (job: Job): Promise<{ dispatched: boolean }> => {
    if (job.name !== EVENT_JOBS.dispatch) throw new Error(`Unknown event job: ${job.name}`);
    const { eventId } = job.data as { eventId?: string };
    if (!eventId) throw new Error('dispatch-event needs an eventId');
    const event = await deps.prisma.domainEvent.findUnique({ where: { id: eventId } });
    if (!event || event.dispatchedAt) return { dispatched: false };
    await deps.prisma.domainEvent.update({
      where: { id: eventId },
      data: { attempts: { increment: 1 } },
    });
    for (const handler of deps.handlers) await handler(event);
    const stamped = await deps.prisma.domainEvent.updateMany({
      where: { id: eventId, dispatchedAt: null },
      data: { dispatchedAt: (deps.now ?? (() => new Date()))() },
    });
    deps.log?.info({ eventId, type: event.type }, 'event dispatched');
    return { dispatched: stamped.count > 0 };
  };
}

/** Ids of events nobody dispatched within 30 s (Redis was down, worker was restarting, …). */
export async function findUndispatchedEventIds(
  prisma: Pick<PrismaService, 'domainEvent'>,
  now: Date,
): Promise<string[]> {
  const rows = await prisma.domainEvent.findMany({
    where: {
      dispatchedAt: null,
      occurredAt: { lt: new Date(now.getTime() - SWEEP_MIN_AGE_MS) },
      attempts: { lt: MAX_DISPATCH_ATTEMPTS },
    },
    orderBy: { occurredAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Raises `activity.overdue` and `contract.expiring`. Every situation has a deterministic
 * `dedupe_key`, so running every 15 minutes (or twice at once) creates each event exactly once;
 * moving a task's deadline or a contract's end date is a new situation and raises a new event.
 * Returns the number of events created. They are dispatched by the sweeper like any other
 * undispatched event.
 */
export async function scanTimeEvents(
  prisma: Pick<PrismaService, 'activity' | 'contract' | 'domainEvent'>,
  now: Date,
): Promise<number> {
  const overdue = await prisma.activity.findMany({
    where: {
      type: 'TASK',
      status: 'PLANNED',
      deletedAt: null,
      dueAt: { lt: now, gte: new Date(now.getTime() - OVERDUE_LOOKBACK_DAYS * DAY_MS) },
    },
    take: SWEEP_BATCH,
    orderBy: { dueAt: 'asc' },
  });
  const rows: ReturnType<typeof buildEventRow>[] = overdue.map((a) =>
    buildEventRow({
      organizationId: a.organizationId,
      type: 'activity.overdue',
      entityType: 'activity',
      entityId: a.id,
      payload: {
        title: a.title,
        priority: a.priority,
        assigneeId: a.assigneeId,
        dueAt: a.dueAt!.toISOString(),
        customerId: a.customerId,
        dealId: a.dealId,
      },
      dedupeKey: `activity.overdue:${a.id}:${a.dueAt!.getTime()}`,
    }),
  );

  const today = tehranToday(now.getTime());
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const expiring = await prisma.contract.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      endDate: {
        gte: new Date(todayMs),
        lte: new Date(todayMs + CONTRACT_EXPIRY_WINDOW_DAYS * DAY_MS),
      },
    },
    take: SWEEP_BATCH,
  });
  for (const c of expiring) {
    const endDate = c.endDate!.toISOString().slice(0, 10);
    rows.push(
      buildEventRow({
        organizationId: c.organizationId,
        type: 'contract.expiring',
        entityType: 'contract',
        entityId: c.id,
        payload: {
          number: contractNumber(c.seq),
          title: c.title,
          customerId: c.customerId,
          endDate,
          daysLeft: Math.round((c.endDate!.getTime() - todayMs) / DAY_MS),
          amount: c.amount.toString(),
        },
        dedupeKey: `contract.expiring:${c.id}:${endDate}`,
      }),
    );
  }
  if (rows.length === 0) return 0;
  const res = await prisma.domainEvent.createMany({ data: rows as never, skipDuplicates: true });
  return res.count;
}

/** Deletes events that were dispatched more than `retentionDays` ago. */
export async function purgeDispatchedEvents(
  prisma: Pick<PrismaService, 'domainEvent'>,
  now: Date,
  retentionDays: number,
): Promise<number> {
  const res = await prisma.domainEvent.deleteMany({
    where: { dispatchedAt: { lt: new Date(now.getTime() - retentionDays * DAY_MS) } },
  });
  return res.count;
}
