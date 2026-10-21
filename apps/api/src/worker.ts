import 'reflect-metadata';
import { createServer } from 'node:http';
import { Logger as NestLogger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger, LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, loadConfig, type AppConfig } from './config';
import { InfraModule } from './infra/infra.module';
import { PrismaService } from './infra/prisma.service';
import { QueueService } from './infra/queue/queue.service';
import { startWorker } from './jobs/start-worker';

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
  const { isRunning, stop } = await startWorker(queues, prisma, config, pino);

  // Container health only: no public surface. 200 while the worker runs and Redis answers.
  const health = createServer((req, res) => {
    void (async () => {
      const ok = req.url === '/health/live' && isRunning() && (await queues.ping());
      res.statusCode = ok ? 200 : 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error' }));
    })();
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
