import { Worker } from 'bullmq';
import type { AppConfig } from '../config';
import type { PrismaService } from '../infra/prisma.service';
import type { QueueService } from '../infra/queue/queue.service';
import { QUEUES } from '../infra/queue/queues';
import { publishEventIds } from '../modules/events/domain-events.service';
import { createEventsProcessor, type EventHandler } from './events';
import { EVENT_HANDLERS } from './handlers';
import { createMaintenanceProcessor } from './maintenance';

/** Starts the maintenance and events workers; `stop()` drains in-flight jobs. */
export async function startWorker(
  queues: QueueService,
  prisma: PrismaService,
  config: AppConfig,
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  handlers: EventHandler[] = EVENT_HANDLERS,
) {
  const maintenance = new Worker(
    QUEUES.maintenance,
    createMaintenanceProcessor({
      prisma,
      retentionDays: config.SESSION_RETENTION_DAYS,
      eventRetentionDays: config.EVENT_RETENTION_DAYS,
      publishEvents: (ids) => publishEventIds(queues, ids),
      log,
    }),
    { connection: queues.newConnection(), concurrency: 1 },
  );
  const events = new Worker(QUEUES.events, createEventsProcessor({ prisma, handlers, log }), {
    connection: queues.newConnection(),
    concurrency: 5,
  });
  const workers = [maintenance, events];
  for (const w of workers) {
    w.on('failed', (job, err) =>
      log.error({ queue: w.name, job: job?.name, err: err.message }, 'job failed'),
    );
  }
  await Promise.all(workers.map((w) => w.waitUntilReady()));
  const schedules = await queues.ensureSchedules();
  log.info({ schedules }, 'worker ready');
  return {
    workers,
    isRunning: () => workers.every((w) => w.isRunning()),
    stop: async () => {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
