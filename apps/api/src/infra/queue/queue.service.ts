import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config';
import { MAINTENANCE_SCHEDULES, QUEUES, type QueueName } from './queues';

/**
 * Owns the Redis connection and the queues. Redis is optional for the API: when REDIS_URL is
 * absent every method is a safe no-op / `null`, so the API still serves traffic (readiness does
 * not claim Redis is up). The worker requires it and refuses to start without it.
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly log = new Logger(QueueService.name);
  private connection: IORedis | null = null;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.REDIS_URL);
  }

  /** BullMQ requires `maxRetriesPerRequest: null` on connections used by workers. */
  newConnection(): IORedis {
    if (!this.config.REDIS_URL) throw new Error('REDIS_URL is not configured');
    return new IORedis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
  }

  private shared(): IORedis {
    this.connection ??= this.newConnection();
    return this.connection;
  }

  queue(name: QueueName): Queue | null {
    if (!this.enabled) return null;
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.shared() });
      this.queues.set(name, q);
    }
    return q;
  }

  /** Registers the repeatable jobs. Idempotent: schedulers are upserted by id. */
  async ensureSchedules(): Promise<number> {
    const q = this.queue(QUEUES.maintenance);
    if (!q) return 0;
    for (const s of MAINTENANCE_SCHEDULES) {
      await q.upsertJobScheduler(
        s.id,
        { pattern: s.pattern, tz: 'UTC' },
        {
          name: s.job,
          opts: {
            removeOnComplete: 50,
            removeOnFail: 200,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
          },
        },
      );
    }
    return MAINTENANCE_SCHEDULES.length;
  }

  /** Readiness probe: `true` when Redis answers, `false` when configured but unreachable. */
  async ping(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      return (await this.shared().ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
    if (this.connection) {
      await this.connection.quit().catch(() => this.connection?.disconnect());
      this.connection = null;
    }
    this.log.log('queue connections closed');
  }
}
