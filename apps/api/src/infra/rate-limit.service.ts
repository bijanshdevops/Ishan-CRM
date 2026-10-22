import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config';
import { RateLimiter } from '../common/rate-limiter';

/** Atomic fixed-window counter: the window starts at the first hit and the key always expires. */
const INCR_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c`;

export type CounterClient = { eval: (...args: unknown[]) => Promise<unknown> };

/**
 * Shared request limiter (ADR 0018). With `REDIS_URL` the counters live in Redis, so every API
 * replica sees the same attempts; without Redis, or while it is unreachable, each process falls
 * back to its own in-memory window. Failing to the local limit keeps sign-in working during a
 * Redis outage and still bounds the attempts each replica accepts.
 */
@Injectable()
export class RateLimitService implements OnApplicationShutdown {
  private readonly log = new Logger(RateLimitService.name);
  private redis: CounterClient | null = null;
  private owned: IORedis | null = null;
  private readonly local = new Map<string, RateLimiter>();
  private lastWarn = 0;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.REDIS_URL) {
      // Fail fast instead of queueing: a slow Redis must never make sign-in wait.
      this.owned = new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 1_000,
        commandTimeout: 500,
      });
      this.owned.on('error', (e) => this.warn(e));
      this.redis = this.owned as unknown as CounterClient;
    }
  }

  /** Test seam: replace the Redis client. */
  useClient(client: CounterClient | null): void {
    this.redis = client;
  }

  /** True when the call is allowed (`max` calls per `windowMs` for `key`). */
  async allow(key: string, max: number, windowMs: number): Promise<boolean> {
    if (this.redis) {
      try {
        const count = Number(await this.redis.eval(INCR_SCRIPT, 1, `rl:${key}`, windowMs));
        return count <= max;
      } catch (e) {
        this.warn(e);
      }
    }
    const id = `${max}:${windowMs}`;
    let limiter = this.local.get(id);
    if (!limiter) {
      limiter = new RateLimiter(max, windowMs);
      this.local.set(id, limiter);
    }
    return limiter.allow(key);
  }

  private warn(e: unknown): void {
    const now = Date.now();
    if (now - this.lastWarn < 60_000) return;
    this.lastWarn = now;
    this.log.warn(`Redis rate limiting unavailable, using the local window: ${String(e)}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.owned?.quit().catch(() => undefined);
  }
}
