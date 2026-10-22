import 'reflect-metadata';
import { Logger as NestLogger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger, LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, loadConfig, type AppConfig } from './config';
import { InfraModule } from './infra/infra.module';
import { PrismaService } from './infra/prisma.service';
import { QueueService } from './infra/queue/queue.service';
import { startWorker } from './jobs/start-worker';
import { createWorkerServer } from './jobs/worker-http';
import { collectQueueSnapshots, JobCounters, renderMetrics } from './infra/queue/queue-metrics';
import { QUEUES } from './infra/queue/queues';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => {
        const c = loadConfig();
        return {
          pinoHttp: {
            level: c.LOG_LEVEL,
            genReqId: () => randomUUID(),
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
        };
      },
    }),
    InfraModule,
  ],
})
class WorkerModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const log = app.get(Logger);
  app.useLogger(log);
  const config = app.get<AppConfig>(APP_CONFIG);
  const queues = app.get(QueueService);
  if (!queues.enabled) {
    new NestLogger('worker').error('REDIS_URL is required to run the worker');
    process.exit(1);
  }
  const prisma = app.get(PrismaService);
  const pino = {
    info: (o: object, m: string) => log.log(o, m),
    error: (o: object, m: string) => log.error(o, m),
  };
  const { workers, isRunning, stop } = await startWorker(queues, prisma, config, pino);

  // Internal only (never published): container health and Prometheus metrics, see ADR 0019.
  const counters = new JobCounters();
  workers.forEach((w) => counters.attach(w));
  const health = createWorkerServer({
    isRunning,
    ping: () => queues.ping(),
    metrics: async () =>
      renderMetrics({
        snapshots: await collectQueueSnapshots(queues),
        expectedQueues: Object.keys(QUEUES).length,
        counters,
        workerUp: isRunning(),
      }),
  });
  health.listen(config.WORKER_PORT, '0.0.0.0');

  const shutdown = async (signal: string) => {
    log.log({ signal }, 'shutting down worker');
    health.close();
    await stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
