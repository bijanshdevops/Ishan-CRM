import 'reflect-metadata';
import { Worker, QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEventsProcessor, type DispatchedEvent } from '../src/jobs/events';
import { createWorkflowHandler, runWorkflow } from '../src/jobs/workflow-engine';
import { QUEUES } from '../src/infra/queue/queues';
import { applyTestEnv } from './helpers';

const ORG = randomUUID();
const OWNER = randomUUID();
const ACTOR = randomUUID();
const CUSTOMER = randomUUID();
const DEAL = randomUUID();
const STAGE = randomUUID();
const NOW = new Date('2026-10-21T10:00:00.000Z');

const dealPayload = (over: Record<string, unknown> = {}) => ({
  title: 'قرارداد الف',
  customerId: CUSTOMER,
  fromStageId: randomUUID(),
  stageId: STAGE,
  stageKind: 'WON',
  amount: '5000000',
  ownerId: OWNER,
  ...over,
});
const event = (over: Partial<DispatchedEvent> = {}): DispatchedEvent => ({
  id: randomUUID(),
  organizationId: ORG,
  type: 'deal.stage_changed',
  entityType: 'deal',
  entityId: DEAL,
  actorId: ACTOR,
  payload: dealPayload(),
  causedByRunId: null,
  occurredAt: NOW,
  ...over,
});
const notify = { type: 'notify', to: 'owner', title: 'برنده شد: {{title}}' } as const;

describe('workflow handler (no services)', () => {
  function fake(workflows: any[]) {
    const ran: string[] = [];
    const prisma = {
      workflow: { findMany: async () => workflows },
      workflowRun: { create: async () => ({}) },
      $transaction: async (fn: any) => {
        ran.push('tx');
        return fn({
          workflowRun: { create: async () => ({ id: 'run' }), update: async () => ({}) },
          user: { findFirst: async () => ({ id: OWNER }) },
          notification: { create: async () => ({ id: 'n1' }) },
          activity: { create: async () => ({ id: 'a1' }) },
        });
      },
    } as any;
    return { prisma, ran };
  }
  const wf = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    organizationId: ORG,
    name: 'wf',
    createdById: ACTOR,
    conditions: [],
    actions: [notify],
    ...over,
  });

  it('never runs for events caused by a workflow', async () => {
    const { prisma, ran } = fake([wf()]);
    await createWorkflowHandler({ prisma, now: () => NOW })(event({ causedByRunId: randomUUID() }));
    expect(ran).toEqual([]);
  });

  it('skips unknown types and invalid payloads instead of failing forever', async () => {
    const { prisma, ran } = fake([wf()]);
    const h = createWorkflowHandler({ prisma, now: () => NOW, log: { info() {}, error() {} } });
    await h(event({ type: 'user.deleted' }));
    await h(event({ payload: { nope: true } }));
    expect(ran).toEqual([]);
  });

  it('runs only workflows whose conditions hold, at most 20 per event', async () => {
    const hit = wf({ conditions: [{ field: 'stageKind', op: 'eq', value: 'WON' }] });
    const miss = wf({ conditions: [{ field: 'stageKind', op: 'eq', value: 'LOST' }] });
    const { prisma, ran } = fake([hit, miss]);
    await createWorkflowHandler({ prisma, now: () => NOW })(event());
    expect(ran).toHaveLength(1);

    const many = fake(Array.from({ length: 30 }, () => wf()));
    await createWorkflowHandler({ prisma: many.prisma, now: () => NOW })(event());
    expect(many.ran).toHaveLength(20);
  });

  it('treats a unique violation as an already-processed event', async () => {
    const prisma = {
      workflowRun: { create: async () => ({}) },
      $transaction: async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      },
    } as any;
    expect(await runWorkflow({ prisma, now: () => NOW }, wf() as any, event(), dealPayload())).toBe(
      'duplicate',
    );
  });

  it('rethrows unexpected errors (so the job is retried) but still runs the other workflows', async () => {
    let calls = 0;
    const prisma = {
      workflow: { findMany: async () => [wf(), wf()] },
      workflowRun: { create: async () => ({}) },
      $transaction: async () => {
        calls++;
        if (calls === 1) throw new Error('database down');
        return undefined;
      },
    } as any;
    await expect(createWorkflowHandler({ prisma, now: () => NOW })(event())).rejects.toThrow(
      'database down',
    );
    expect(calls).toBe(2);
  });
});

/** Real PostgreSQL (CI). */
const db = process.env.RUN_DB_TESTS === '1';
const redis = db && Boolean(process.env.REDIS_URL);

describe.skipIf(!db)('workflow engine (database)', () => {
  let app: any;
  let prisma: any;
  let orgId = '';
  const users: Record<string, string> = {};
  const workflowIds: string[] = [];
  const handlerDeps = () => ({ prisma, log: { info() {}, error() {} } });

  async function mkUser(name: string, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
    const role = await prisma.role.findFirstOrThrow({
      where: { organizationId: orgId, key: 'sales' },
    });
    const u = await prisma.user.create({
      data: {
        organizationId: orgId,
        roleId: role.id,
        email: `wfe-${name}@example.com`,
        name: `wfe-${name}`,
        passwordHash: 'x',
        status,
      },
    });
    users[name] = u.id;
    return u.id as string;
  }
  async function mkWorkflow(
    createdById: string,
    actions: unknown[],
    conditions: unknown[] = [],
    enabled = true,
  ) {
    const w = await prisma.workflow.create({
      data: {
        organizationId: orgId,
        name: `wfe-${randomUUID().slice(0, 8)}`,
        triggerType: 'deal.stage_changed',
        conditions,
        actions,
        enabled,
        createdById,
      },
    });
    workflowIds.push(w.id);
    return w.id as string;
  }
  async function mkContext() {
    const customer = await prisma.customer.create({
      data: {
        organizationId: orgId,
        kind: 'PERSON',
        name: 'wfe-customer',
        searchText: 'wfe',
        createdById: users.owner,
      },
    });
    const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { organizationId: orgId } });
    const deal = await prisma.deal.create({
      data: {
        organizationId: orgId,
        title: 'wfe-deal',
        customerId: customer.id,
        stageId: stage.id,
        createdById: users.owner,
      },
    });
    return {
      customerId: customer.id as string,
      stageId: stage.id as string,
      dealId: deal.id as string,
    };
  }
  async function mkEvent(over: Record<string, unknown> = {}) {
    const c = await mkContext();
    const row = await prisma.domainEvent.create({
      data: {
        organizationId: orgId,
        type: 'deal.stage_changed',
        entityType: 'deal',
        entityId: c.dealId,
        actorId: users.actor,
        payload: dealPayload({
          customerId: c.customerId,
          stageId: c.stageId,
          ownerId: users.owner,
        }),
        ...over,
      },
    });
    return row as DispatchedEvent;
  }

  beforeAll(async () => {
    applyTestEnv();
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    orgId = (await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } })).id;
    await mkUser('owner');
    await mkUser('actor');
    await mkUser('creator');
    await mkUser('off', 'DISABLED');
  });

  // Workflows of earlier tests must not react to this test's events.
  beforeEach(async () => {
    if (workflowIds.length) {
      await prisma.workflow.updateMany({
        where: { id: { in: workflowIds } },
        data: { enabled: false },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      const ids = Object.values(users);
      await prisma.domainEvent.deleteMany({ where: { actorId: { in: ids } } });
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.activity.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.workflow.deleteMany({ where: { id: { in: workflowIds } } });
      await prisma.deal.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.customer.deleteMany({ where: { name: 'wfe-customer' } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  it('notifies the owner with a rendered, linked notification and records one run', async () => {
    const wfId = await mkWorkflow(
      users.creator!,
      [notify],
      [{ field: 'stageKind', op: 'eq', value: 'WON' }],
    );
    const ev = await mkEvent();
    await createWorkflowHandler(handlerDeps())(ev);
    const notes = await prisma.notification.findMany({ where: { userId: users.owner } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'workflow',
      title: 'برنده شد: قرارداد الف',
      entityType: 'deal',
      entityId: ev.entityId,
    });
    const runs = await prisma.workflowRun.findMany({ where: { workflowId: wfId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'SUCCEEDED', eventId: ev.id });
    expect(runs[0].steps[0]).toMatchObject({
      action: 'notify',
      status: 'done',
      createdId: notes[0].id,
    });
    expect(notes[0].workflowRunId).toBe(runs[0].id);
  });

  it('is idempotent: delivering the same event again changes nothing', async () => {
    const wfId = await mkWorkflow(users.creator!, [notify]);
    const ev = await mkEvent();
    const h = createWorkflowHandler(handlerDeps());
    await h(ev);
    await h(ev);
    await Promise.all([h(ev), h(ev)]);
    expect(await prisma.workflowRun.count({ where: { workflowId: wfId, eventId: ev.id } })).toBe(1);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: wfId } });
    expect(await prisma.notification.count({ where: { workflowRunId: run.id } })).toBe(1);
  });

  it('creates a task under the workflow creator, due in N days, linked to customer and deal', async () => {
    const wfId = await mkWorkflow(users.creator!, [
      {
        type: 'create_task',
        title: 'پیگیری {{title}}',
        dueInDays: 3,
        priority: 'HIGH',
        assignee: 'owner',
      },
    ]);
    const ev = await mkEvent();
    await createWorkflowHandler({ ...handlerDeps(), now: () => NOW })(ev);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: wfId } });
    const task = await prisma.activity.findUniqueOrThrow({ where: { id: run.steps[0].createdId } });
    expect(task).toMatchObject({
      type: 'TASK',
      status: 'PLANNED',
      priority: 'HIGH',
      title: 'پیگیری قرارداد الف',
      assigneeId: users.owner,
      createdById: users.creator,
      dealId: ev.entityId,
      customerId: (ev.payload as any).customerId,
    });
    expect(task.dueAt.toISOString()).toBe(new Date(NOW.getTime() + 3 * 86_400_000).toISOString());
  });

  it('does not run disabled or deleted workflows, nor ones whose conditions fail', async () => {
    const off = await mkWorkflow(users.creator!, [notify], [], false);
    const gone = await mkWorkflow(users.creator!, [notify]);
    await prisma.workflow.update({ where: { id: gone }, data: { deletedAt: new Date() } });
    const lost = await mkWorkflow(
      users.creator!,
      [notify],
      [{ field: 'stageKind', op: 'eq', value: 'LOST' }],
    );
    const small = await mkWorkflow(
      users.creator!,
      [notify],
      [{ field: 'amount', op: 'gt', value: '999999999' }],
    );
    await createWorkflowHandler(handlerDeps())(await mkEvent());
    for (const id of [off, gone, lost, small]) {
      expect(await prisma.workflowRun.count({ where: { workflowId: id } })).toBe(0);
    }
  });

  it('ignores events caused by a workflow run (no chains)', async () => {
    const wfId = await mkWorkflow(users.creator!, [notify]);
    const ev = await mkEvent({ causedByRunId: randomUUID() });
    await createWorkflowHandler(handlerDeps())(ev);
    expect(await prisma.workflowRun.count({ where: { workflowId: wfId } })).toBe(0);
  });

  it('skips owner/actor targets that are missing or inactive, and keeps the run successful', async () => {
    const wfId = await mkWorkflow(users.creator!, [
      { type: 'notify', to: 'actor', title: 'برای کنشگر' },
      { type: 'notify', to: 'owner', title: 'برای مالک' },
    ]);
    const ev = await mkEvent({
      actorId: null,
      payload: dealPayload({ customerId: randomUUID(), ownerId: users.off }),
    });
    // customerId is only a string in the payload; the notification does not reference it
    await createWorkflowHandler(handlerDeps())(ev);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: wfId } });
    expect(run.status).toBe('SUCCEEDED');
    expect(run.steps.map((s: any) => s.status)).toEqual(['skipped', 'skipped']);
    expect(await prisma.notification.count({ where: { userId: users.off } })).toBe(0);
  });

  it('records FAILED with a clear message and leaves no half-done work when the creator is inactive', async () => {
    const wfId = await mkWorkflow(users.off!, [
      { type: 'notify', to: 'owner', title: 'نباید بماند' },
      { type: 'create_task', title: 'وظیفه', dueInDays: 1, priority: 'LOW', assignee: 'owner' },
    ]);
    const ev = await mkEvent();
    const before = await prisma.notification.count({ where: { userId: users.owner } });
    await createWorkflowHandler(handlerDeps())(ev);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: wfId } });
    expect(run.status).toBe('FAILED');
    expect(run.error).toContain('سازنده');
    expect(run.steps.map((s: any) => s.status)).toEqual(['done', 'failed']);
    // the first action's notification was rolled back together with the failure
    expect(await prisma.notification.count({ where: { userId: users.owner } })).toBe(before);
    expect(await prisma.activity.count({ where: { createdById: users.off } })).toBe(0);
    // redelivery does not run it again or add another run
    await createWorkflowHandler(handlerDeps())(ev);
    expect(await prisma.workflowRun.count({ where: { workflowId: wfId } })).toBe(1);
  });

  it('fails when an explicitly chosen recipient is not an active user of the organization', async () => {
    const wfId = await mkWorkflow(users.creator!, [
      { type: 'notify', to: { userId: randomUUID() }, title: 'گیرنده نامعتبر' },
    ]);
    await createWorkflowHandler(handlerDeps())(await mkEvent());
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: wfId } });
    expect(run.status).toBe('FAILED');
    expect(run.steps[0]).toMatchObject({ action: 'notify', status: 'failed' });
  });

  it('keeps one failing workflow from blocking the others', async () => {
    const bad = await mkWorkflow(users.off!, [
      { type: 'create_task', title: 'وظیفه', dueInDays: 1, priority: 'LOW', assignee: 'owner' },
    ]);
    const good = await mkWorkflow(users.creator!, [notify]);
    const ev = await mkEvent();
    await createWorkflowHandler(handlerDeps())(ev);
    expect((await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: bad } })).status).toBe(
      'FAILED',
    );
    expect(
      (await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: good } })).status,
    ).toBe('SUCCEEDED');
  });

  it('enforces the run table invariants', async () => {
    const wfId = await mkWorkflow(users.creator!, [notify]);
    const base = { workflowId: wfId, startedAt: NOW, finishedAt: NOW, steps: [] };
    await prisma.workflowRun.create({
      data: { ...base, eventId: randomUUID(), status: 'SUCCEEDED' },
    });
    const ev = randomUUID();
    await prisma.workflowRun.create({ data: { ...base, eventId: ev, status: 'SUCCEEDED' } });
    await expect(
      prisma.workflowRun.create({ data: { ...base, eventId: ev, status: 'SUCCEEDED' } }),
    ).rejects.toThrow();
    await expect(
      prisma.workflowRun.create({ data: { ...base, eventId: randomUUID(), status: 'RUNNING' } }),
    ).rejects.toThrow();
    await expect(
      prisma.workflowRun.create({
        data: { ...base, eventId: randomUUID(), status: 'FAILED', steps: {} },
      }),
    ).rejects.toThrow();
  });

  it.skipIf(!redis)('end to end: emit → queue → worker → handler → notification', async () => {
    const { QueueService } = await import('../src/infra/queue/queue.service');
    const { DomainEventsService } = await import('../src/modules/events/domain-events.service');
    const queues = app.get(QueueService);
    const svc = app.get(DomainEventsService);
    const wfId = await mkWorkflow(users.creator!, [
      { type: 'notify', to: 'owner', title: 'پایان‌به‌پایان {{title}}' },
    ]);
    const worker = new Worker(
      QUEUES.events,
      createEventsProcessor({ prisma, handlers: [createWorkflowHandler(handlerDeps())] }),
      {
        connection: queues.newConnection(),
      },
    );
    const qe = new QueueEvents(QUEUES.events, { connection: queues.newConnection() });
    try {
      await qe.waitUntilReady();
      const c = await mkContext();
      const id = await svc.emit(prisma, {
        organizationId: orgId,
        type: 'deal.stage_changed',
        entityType: 'deal',
        entityId: c.dealId,
        actorId: users.actor,
        payload: {
          title: 'قرارداد ب',
          customerId: c.customerId,
          fromStageId: c.stageId,
          stageId: c.stageId,
          stageKind: 'WON',
          amount: '10',
          ownerId: users.owner,
        },
      });
      await svc.publish([id]);
      for (let i = 0; i < 100; i++) {
        if ((await prisma.workflowRun.count({ where: { workflowId: wfId } })) > 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: wfId } });
      expect(run.status).toBe('SUCCEEDED');
      expect(
        await prisma.notification.count({
          where: { userId: users.owner, title: 'پایان‌به‌پایان قرارداد ب' },
        }),
      ).toBe(1);
      for (let i = 0; i < 50; i++) {
        if ((await prisma.domainEvent.findUniqueOrThrow({ where: { id } })).dispatchedAt) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(
        (await prisma.domainEvent.findUniqueOrThrow({ where: { id } })).dispatchedAt,
      ).not.toBeNull();
    } finally {
      await qe.close();
      await worker.close();
    }
  });
});
