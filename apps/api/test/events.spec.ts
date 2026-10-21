import 'reflect-metadata';
import { QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEventsProcessor,
  findUndispatchedEventIds,
  MAX_DISPATCH_ATTEMPTS,
  SWEEP_MIN_AGE_MS,
  scanTimeEvents,
} from '../src/jobs/events';
import { buildEventRow } from '../src/modules/events/domain-events.service';
import { EVENT_JOBS, QUEUES } from '../src/infra/queue/queues';
import { applyTestEnv } from './helpers';

const NOW = new Date('2026-10-21T10:00:00.000Z');
const ORG = randomUUID();
const ENTITY = randomUUID();

describe('domain events (no services)', () => {
  it('builds a validated row and rejects payloads outside the catalog', () => {
    const row = buildEventRow({
      organizationId: ORG,
      type: 'quote.accepted',
      entityType: 'quote',
      entityId: ENTITY,
      payload: { number: 'Q-1', title: 't', customerId: randomUUID(), total: '10', ownerId: null },
    });
    expect(row.type).toBe('quote.accepted');
    expect(row.actorId).toBeNull();
    expect(row.dedupeKey).toBeNull();
    expect(() =>
      buildEventRow({
        organizationId: ORG,
        type: 'quote.accepted',
        entityType: 'quote',
        entityId: ENTITY,
        payload: { number: 'Q-1', extra: true } as any,
      }),
    ).toThrow();
  });

  it('runs every handler, counts the attempt and stamps dispatched_at once', async () => {
    const calls: string[] = [];
    let row: any = { id: 'e1', type: 'lead.created', dispatchedAt: null, attempts: 0 };
    const prisma = {
      domainEvent: {
        findUnique: async () => row,
        update: async () => {
          row = { ...row, attempts: row.attempts + 1 };
          return row;
        },
        updateMany: async (args: any) => {
          if (row.dispatchedAt && args.where.dispatchedAt === null) return { count: 0 };
          row = { ...row, dispatchedAt: args.data.dispatchedAt };
          return { count: 1 };
        },
      },
    } as any;
    const run = createEventsProcessor({
      prisma,
      handlers: [
        async (e) => void calls.push(`a:${e.id}`),
        async (e) => void calls.push(`b:${e.id}`),
      ],
      now: () => NOW,
    });
    const job = { name: EVENT_JOBS.dispatch, data: { eventId: 'e1' } } as any;
    expect(await run(job)).toEqual({ dispatched: true });
    expect(calls).toEqual(['a:e1', 'b:e1']);
    expect(row.dispatchedAt).toEqual(NOW);
    // a duplicate job for an already dispatched event does nothing
    expect(await run(job)).toEqual({ dispatched: false });
    expect(calls).toHaveLength(2);
    await expect(run({ name: 'x', data: {} } as any)).rejects.toThrow('Unknown event job');
    await expect(run({ name: EVENT_JOBS.dispatch, data: {} } as any)).rejects.toThrow('eventId');
  });

  it('keeps the event undispatched when a handler throws', async () => {
    let stamped = false;
    const prisma = {
      domainEvent: {
        findUnique: async () => ({ id: 'e2', dispatchedAt: null }),
        update: async () => ({}),
        updateMany: async () => {
          stamped = true;
          return { count: 1 };
        },
      },
    } as any;
    const run = createEventsProcessor({
      prisma,
      handlers: [
        async () => {
          throw new Error('boom');
        },
      ],
    });
    await expect(
      run({ name: EVENT_JOBS.dispatch, data: { eventId: 'e2' } } as any),
    ).rejects.toThrow('boom');
    expect(stamped).toBe(false);
  });

  it('sweeps only old, undispatched, non-poisoned events', async () => {
    let where: any;
    const prisma = {
      domainEvent: {
        findMany: async (args: any) => {
          where = args.where;
          return [{ id: 'a' }, { id: 'b' }];
        },
      },
    } as any;
    expect(await findUndispatchedEventIds(prisma, NOW)).toEqual(['a', 'b']);
    expect(where).toEqual({
      dispatchedAt: null,
      occurredAt: { lt: new Date(NOW.getTime() - SWEEP_MIN_AGE_MS) },
      attempts: { lt: MAX_DISPATCH_ATTEMPTS },
    });
  });

  it('raises time events with deterministic dedupe keys', async () => {
    const due = new Date('2026-10-20T08:00:00.000Z');
    let rows: any[] = [];
    const prisma = {
      activity: {
        findMany: async () => [
          {
            id: 'act1',
            organizationId: ORG,
            title: 'تماس',
            priority: 'HIGH',
            assigneeId: null,
            dueAt: due,
            customerId: null,
            dealId: null,
          },
        ],
      },
      contract: { findMany: async () => [] },
      domainEvent: {
        createMany: async (args: any) => {
          rows = args.data;
          expect(args.skipDuplicates).toBe(true);
          return { count: rows.length };
        },
      },
    } as any;
    expect(await scanTimeEvents(prisma, NOW)).toBe(1);
    expect(rows[0].type).toBe('activity.overdue');
    expect(rows[0].dedupeKey).toBe(`activity.overdue:act1:${due.getTime()}`);
  });
});

/** Real PostgreSQL + Redis (CI). */
const run = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.REDIS_URL);

describe.skipIf(!run)('domain events (database + redis)', () => {
  let app: any;
  let prisma: any;
  let queues: any;
  let svc: any;
  let org = '';
  let qEvents: QueueEvents | undefined;
  let stop: (() => Promise<void>) | undefined;
  const handled: string[] = [];

  beforeAll(async () => {
    applyTestEnv({ REDIS_URL: process.env.REDIS_URL! });
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { QueueService } = await import('../src/infra/queue/queue.service');
    const { DomainEventsService } = await import('../src/modules/events/domain-events.service');
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    queues = app.get(QueueService);
    svc = app.get(DomainEventsService);
    org = (await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } })).id;
    const { Worker } = await import('bullmq');
    const worker = new Worker(
      QUEUES.events,
      createEventsProcessor({
        prisma,
        handlers: [async (e) => void handled.push(e.id)],
      }),
      { connection: queues.newConnection() },
    );
    stop = async () => void (await worker.close());
    qEvents = new QueueEvents(QUEUES.events, { connection: queues.newConnection() });
    await qEvents.waitUntilReady();
  });

  afterAll(async () => {
    await qEvents?.close();
    await stop?.();
    if (prisma) await prisma.domainEvent.deleteMany({ where: { entityType: 'events-spec' } });
    await app?.close();
  });

  const input = (n: string, extra: Record<string, unknown> = {}) => ({
    organizationId: org,
    type: 'lead.created' as const,
    entityType: 'events-spec',
    entityId: randomUUID(),
    payload: { name: n, sourceId: null, campaignId: null, ownerId: null },
    ...extra,
  });

  it('emit → queue → handler → dispatched_at, and a re-publish does not run it twice', async () => {
    const id = await svc.emit(prisma, input('one'));
    expect((await prisma.domainEvent.findUniqueOrThrow({ where: { id } })).dispatchedAt).toBeNull();
    await svc.publish([id]);
    for (let i = 0; i < 50; i++) {
      const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id } });
      if (row.dispatchedAt) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id } });
    expect(row.dispatchedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    await svc.publish([id]);
    await new Promise((r) => setTimeout(r, 500));
    expect(handled.filter((h) => h === id)).toHaveLength(1);
  });

  it('rolls an event back together with a failed transaction', async () => {
    const entityId = randomUUID();
    await expect(
      prisma.$transaction(async (tx: any) => {
        await svc.emit(tx, input('rolled', { entityId }));
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await prisma.domainEvent.count({ where: { entityId } })).toBe(0);
  });

  it('the sweeper finds an abandoned event, and not a fresh one', async () => {
    const fresh = await svc.emit(prisma, input('fresh'));
    const old = await svc.emit(prisma, input('old'));
    await prisma.domainEvent.update({
      where: { id: old },
      data: { occurredAt: new Date(Date.now() - 5 * 60_000) },
    });
    const ids = await findUndispatchedEventIds(prisma, new Date());
    expect(ids).toContain(old);
    expect(ids).not.toContain(fresh);
  });

  it('refuses a duplicate dedupe key', async () => {
    const dedupeKey = `events-spec:${randomUUID()}`;
    await svc.emit(prisma, input('d1', { dedupeKey }));
    await expect(svc.emit(prisma, input('d2', { dedupeKey }))).rejects.toThrow();
  });

  it('rejects an invalid payload at the database (CHECK) and at the service', async () => {
    await expect(svc.emit(prisma, input('bad', { payload: { nope: 1 } }))).rejects.toThrow();
    await expect(
      prisma.domainEvent.create({
        data: {
          organizationId: org,
          type: 'lead.created',
          entityType: 'events-spec',
          entityId: randomUUID(),
          payload: [1, 2],
        },
      }),
    ).rejects.toThrow();
  });
});
