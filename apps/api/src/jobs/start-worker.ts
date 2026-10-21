import { Worker } from 'bullmq';
import type { AppConfig } from '../config';
import type { PrismaService } from '../infra/prisma.service';
import type { QueueService } from '../infra/queue/queue.service';
import { QUEUES } from '../infra/queue/queues';
import { createMaintenanceProcessor } from './maintenance';

/** Starts the maintenance worker and returns a `stop()` that drains in-flight jobs. */
export async function startWorker(
  queues: QueueService,
  prisma: PrismaService,
  config: AppConfig,
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
) {
  const worker = new Worker(
    QUEUES.maintenance,
    createMaintenanceProcessor({ prisma, retentionDays: config.SESSION_RETENTION_DAYS, log }),
    { connection: queues.newConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));
  await worker.waitUntilReady();
  const schedules = await queues.ensureSchedules();
  log.info({ schedules }, 'worker ready');
  return { worker, stop: () => worker.close() };
}
