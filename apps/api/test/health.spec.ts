import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadConfig } from '../src/config';
import { PrismaService } from '../src/infra/prisma.service';
import { QueueService } from '../src/infra/queue/queue.service';
import { HealthController } from '../src/modules/health/health.controller';
import { TEST_ENV } from './helpers';

async function buildApp(
  dbUp: boolean,
  redis: 'off' | 'up' | 'down' = 'off',
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: APP_CONFIG,
        useValue: loadConfig({ ...TEST_ENV, DATABASE_URL: 'postgresql://unused' }),
      },
      { provide: PrismaService, useValue: { ping: async () => dbUp } },
      {
        provide: QueueService,
        useValue: { enabled: redis !== 'off', ping: async () => redis === 'up' },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('health', () => {
  let up: NestFastifyApplication;
  let down: NestFastifyApplication;
  beforeAll(async () => {
    up = await buildApp(true);
    down = await buildApp(false);
  });
  afterAll(async () => {
    await up.close();
    await down.close();
  });

  it('live returns ok without touching dependencies', async () => {
    const res = await down.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('ready returns 200 when the database is reachable', async () => {
    const res = await up.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.database).toBe('up');
  });

  it('ready returns 503 when the database is down', async () => {
    const res = await down.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('error');
  });

  it('does not report redis when queues are not configured', async () => {
    const res = await up.inject({ method: 'GET', url: '/health/ready' });
    expect(res.json().checks).not.toHaveProperty('redis');
  });

  it('reports redis and turns not-ready when it is configured but unreachable', async () => {
    const withRedis = await buildApp(true, 'up');
    const brokenRedis = await buildApp(true, 'down');
    const ok = await withRedis.inject({ method: 'GET', url: '/health/ready' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().checks.redis).toBe('up');
    const bad = await brokenRedis.inject({ method: 'GET', url: '/health/ready' });
    expect(bad.statusCode).toBe(503);
    expect(bad.json().checks).toMatchObject({ database: 'up', redis: 'down' });
    await withRedis.close();
    await brokenRedis.close();
  });
});
