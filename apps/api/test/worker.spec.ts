import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMaintenanceProcessor, purgeExpiredSessions } from '../src/jobs/maintenance';
import { MAINTENANCE_JOBS, MAINTENANCE_SCHEDULES, QUEUES } from '../src/infra/queue/queues';
import { applyTestEnv } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-21T00:00:00.000Z');

describe('maintenance jobs (no services)', () => {
  it('purges with a cutoff of now minus the retention period', async () => {
    let where: any;
    const prisma = {
      session: {
        deleteMany: async (args: any) => {
          where = args.where;
          return { count: 3 };
        },
      },
    } as any;
    expect(await purgeExpiredSessions(prisma, NOW, 30)).toBe(3);
    const cutoff = new Date(NOW.getTime() - 30 * DAY);
    expect(where.OR).toEqual([
      { expiresAt: { lt: cutoff } },
      { absoluteExpiresAt: { lt: cutoff } },
      { revokedAt: { lt: cutoff } },
    ]);
  });

  it('routes known jobs and rejects unknown ones', async () => {
    const prisma = { session: { deleteMany: async () => ({ count: 2 }) } } as any;
    const run = createMaintenanceProcessor({
      prisma,
      retentionDays: 30,
      eventRetentionDays: 30,
      notificationRetentionDays: 90,
      workflowRunRetentionDays: 90,
      webhookDeliveryRetentionDays: 30,
      emailDeliveryRetentionDays: 30,
      publishEvents: async () => undefined,
      publishDeliveries: async () => undefined,
      publishEmails: async () => undefined,
      now: () => NOW,
    });
    expect(await run({ name: MAINTENANCE_JOBS.purgeExpiredSessions } as any)).toEqual({
      deleted: 2,
    });
    await expect(run({ name: 'nope' } as any)).rejects.toThrow('Unknown maintenance job');
  });

  it('declares a valid daily schedule for every maintenance job', () => {
    const jobs = new Set<string>(Object.values(MAINTENANCE_JOBS));
    for (const s of MAINTENANCE_SCHEDULES) {
      expect(jobs.has(s.job)).toBe(true);
      expect(s.pattern.split(' ')).toHaveLength(5);
    }
    expect(new Set(MAINTENANCE_SCHEDULES.map((s) => s.id)).size).toBe(MAINTENANCE_SCHEDULES.length);
  });
});

/** Real PostgreSQL + Redis (CI). Skipped locally unless both are configured. */
const run = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.REDIS_URL);

describe.skipIf(!run)('worker (database + redis)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let queues: any;
  let stop: (() => Promise<void>) | undefined;
  let events: QueueEvents | undefined;
  let userId = '';
  const created: string[] = [];

  async function session(over: Record<string, Date | null>) {
    const base = {
      userId,
      tokenHash: `worker-spec-${Math.random().toString(36).slice(2)}-${created.length}`,
      expiresAt: new Date(Date.now() + DAY),
      absoluteExpiresAt: new Date(Date.now() + 7 * DAY),
      revokedAt: null,
    };
    const row = await prisma.session.create({ data: { ...base, ...over } });
    created.push(row.id);
    return row.id as string;
  }

  beforeAll(async () => {
    applyTestEnv({ REDIS_URL: process.env.REDIS_URL! });
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { QueueService } = await import('../src/infra/queue/queue.service');
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    queues = app.get(QueueService);
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null } })).id;
  });

  afterAll(async () => {
    await events?.close();
    await stop?.();
    if (prisma && created.length)
      await prisma.session.deleteMany({ where: { id: { in: created } } });
    await app?.close();
  });

  it('reports redis as reachable', async () => {
    expect(queues.enabled).toBe(true);
    expect(await queues.ping()).toBe(true);
  });

  it('registers the daily scheduler once, however often the worker starts', async () => {
    expect(await queues.ensureSchedules()).toBe(MAINTENANCE_SCHEDULES.length);
    expect(await queues.ensureSchedules()).toBe(MAINTENANCE_SCHEDULES.length);
    const schedulers = await queues.queue(QUEUES.maintenance).getJobSchedulers();
    const ids = schedulers.map((s: any) => s.key ?? s.id);
    expect(ids.filter((i: string) => i === MAINTENANCE_SCHEDULES[0]!.id)).toHaveLength(1);
  });

  it('a job enqueued on the real queue is processed and only dead sessions are deleted', async () => {
    const old = new Date(Date.now() - 90 * DAY);
    const deadIdle = await session({ expiresAt: old });
    const deadAbsolute = await session({ absoluteExpiresAt: old });
    const deadRevoked = await session({ revokedAt: old });
    const recentlyExpired = await session({ expiresAt: new Date(Date.now() - 2 * DAY) });
    const live = await session({});

    const { startWorker } = await import('../src/jobs/start-worker');
    const { loadConfig } = await import('../src/config');
    const started = await startWorker(queues, prisma, loadConfig(), {
      info: () => undefined,
      error: () => undefined,
    });
    stop = started.stop;
    const q = queues.queue(QUEUES.maintenance);
    events = new QueueEvents(QUEUES.maintenance, { connection: queues.newConnection() });
    await events.waitUntilReady();
    const job = await q.add(MAINTENANCE_JOBS.purgeExpiredSessions, {});
    const result = await job.waitUntilFinished(events, 20_000);
    expect(result.deleted).toBeGreaterThanOrEqual(3);

    const left = await prisma.session.findMany({
      where: { id: { in: created } },
      select: { id: true },
    });
    const ids = left.map((r: any) => r.id);
    expect(ids).not.toContain(deadIdle);
    expect(ids).not.toContain(deadAbsolute);
    expect(ids).not.toContain(deadRevoked);
    expect(ids).toContain(recentlyExpired);
    expect(ids).toContain(live);
  });
});

describe('notification retention (no services)', () => {
  it('deletes only notifications read before the cutoff', async () => {
    const { purgeReadNotifications } = await import('../src/jobs/maintenance');
    let where: any;
    const prisma = {
      notification: {
        deleteMany: async (args: any) => {
          where = args.where;
          return { count: 4 };
        },
      },
    } as any;
    expect(await purgeReadNotifications(prisma, NOW, 90)).toBe(4);
    expect(where).toEqual({ readAt: { lt: new Date(NOW.getTime() - 90 * DAY) } });
  });
});
