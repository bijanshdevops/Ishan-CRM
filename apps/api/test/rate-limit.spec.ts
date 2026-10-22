import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { RateLimitService, type CounterClient } from '../src/infra/rate-limit.service';
import { applyTestEnv } from './helpers';

const config = (extra: Record<string, unknown> = {}) => ({ ...extra }) as never;

/** Minimal in-memory stand-in for the Lua counter, shared like a real Redis would be. */
function fakeRedis(store = new Map<string, number>()): CounterClient {
  return {
    eval: async (...args: unknown[]) => {
      const key = String(args[2]);
      store.set(key, (store.get(key) ?? 0) + 1);
      return store.get(key);
    },
  };
}

describe('RateLimitService (no Redis)', () => {
  it('limits per key inside the window and counts keys separately', async () => {
    const svc = new RateLimitService(config());
    expect(await svc.allow('a', 2, 60_000)).toBe(true);
    expect(await svc.allow('a', 2, 60_000)).toBe(true);
    expect(await svc.allow('a', 2, 60_000)).toBe(false);
    expect(await svc.allow('b', 2, 60_000)).toBe(true);
  });
});

describe('RateLimitService (Redis client)', () => {
  it('shares the counter between instances, as two API replicas would', async () => {
    const store = new Map<string, number>();
    const one = new RateLimitService(config());
    const two = new RateLimitService(config());
    one.useClient(fakeRedis(store));
    two.useClient(fakeRedis(store));
    expect(await one.allow('login:ip:1.2.3.4', 3, 60_000)).toBe(true);
    expect(await two.allow('login:ip:1.2.3.4', 3, 60_000)).toBe(true);
    expect(await one.allow('login:ip:1.2.3.4', 3, 60_000)).toBe(true);
    expect(await two.allow('login:ip:1.2.3.4', 3, 60_000)).toBe(false);
  });

  it('falls back to the local window when Redis fails, instead of failing the request', async () => {
    const svc = new RateLimitService(config());
    svc.useClient({
      eval: async () => {
        throw new Error('connection refused');
      },
    });
    expect(await svc.allow('k', 1, 60_000)).toBe(true);
    expect(await svc.allow('k', 1, 60_000)).toBe(false);
  });
});

const run = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.REDIS_URL);

describe.skipIf(!run)('RateLimitService (real Redis)', () => {
  const services: RateLimitService[] = [];
  afterAll(async () => {
    for (const s of services) await s.onApplicationShutdown();
  });

  it('counts across connections and expires the window', async () => {
    applyTestEnv({ REDIS_URL: process.env.REDIS_URL! });
    const cfg = config({ REDIS_URL: process.env.REDIS_URL });
    const a = new RateLimitService(cfg);
    const b = new RateLimitService(cfg);
    services.push(a, b);
    const key = `spec:${Date.now().toString(36)}`;
    expect(await a.allow(key, 2, 700)).toBe(true);
    expect(await b.allow(key, 2, 700)).toBe(true);
    expect(await a.allow(key, 2, 700)).toBe(false);
    await new Promise((r) => setTimeout(r, 900));
    expect(await b.allow(key, 2, 700)).toBe(true);
  });

  it('serves from the local window when Redis is unreachable', async () => {
    const down = new RateLimitService(config({ REDIS_URL: 'redis://127.0.0.1:1' }));
    services.push(down);
    expect(await down.allow('x', 1, 60_000)).toBe(true);
    expect(await down.allow('x', 1, 60_000)).toBe(false);
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('sign-in limits (database)', () => {
  let app: import('@nestjs/platform-fastify').NestFastifyApplication;
  const ORIGIN = 'http://localhost:3000';

  afterAll(async () => {
    delete process.env.LOGIN_RATE_LIMIT_PER_ACCOUNT_PER_MINUTE;
    await app?.close();
  });

  async function login(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email, password: 'wrong-password' },
    });
    return res.statusCode;
  }

  it('stops guessing one account after the per-account limit, whatever the case of the address', async () => {
    applyTestEnv({ LOGIN_RATE_LIMIT_PER_ACCOUNT_PER_MINUTE: '3' });
    const { createApp } = await import('../src/bootstrap');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const email = `limit-${Date.now().toString(36)}@example.com`;
    expect([await login(email), await login(email.toUpperCase()), await login(email)]).toEqual([
      401, 401, 401,
    ]);
    expect(await login(email)).toBe(429);
    // another account is not affected
    expect(await login(`other-${email}`)).toBe(401);
  });

  it('public endpoints share their per-IP window between replicas (ADR 0022)', async () => {
    if (!process.env.REDIS_URL) return;
    applyTestEnv();
    const { createApp } = await import('../src/bootstrap');
    const other = await createApp();
    await other.init();
    await other.getHttpAdapter().getInstance().ready();
    try {
      // A private address per run: the window is shared through Redis with every other spec.
      const remoteAddress = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
      const hit = async (a: typeof app, url: string, payload: object) =>
        (
          await a.inject({
            method: 'POST',
            url: `/api/v1${url}`,
            remoteAddress,
            headers: { origin: ORIGIN },
            payload,
          })
        ).statusCode;
      const verify = { token: 'x'.repeat(30) };
      const codes: number[] = [];
      for (let i = 0; i < 20; i++)
        codes.push(await hit(i % 2 ? app : other, '/auth/verify-email', verify));
      expect(new Set(codes)).toEqual(new Set([400]));
      // The 21st request is refused whichever replica receives it.
      expect(await hit(app, '/auth/verify-email', verify)).toBe(429);
      expect(await hit(other, '/auth/verify-email', verify)).toBe(429);

      // Another endpoint has its own counter: 30 per minute, then refused.
      const unsub = { token: 'bad' };
      const u: number[] = [];
      for (let i = 0; i < 30; i++)
        u.push(await hit(i % 2 ? app : other, '/public/unsubscribe', unsub));
      expect(new Set(u)).toEqual(new Set([400]));
      expect(await hit(other, '/public/unsubscribe', unsub)).toBe(429);
    } finally {
      await other.close();
    }
  });
});
