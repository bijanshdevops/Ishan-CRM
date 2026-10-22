import type { Worker } from 'bullmq';
import { QUEUES, type QueueName } from './queues';

/** Job states reported per queue (BullMQ `getJobCounts` names). */
export const COUNTED_STATES = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'failed',
  'completed',
  'paused',
] as const;
export type CountedState = (typeof COUNTED_STATES)[number];

export type QueueSnapshot = {
  queue: string;
  counts: Partial<Record<CountedState, number>>;
  /** Age of the oldest waiting job in seconds; 0 when nothing waits. */
  oldestWaitingSeconds: number;
};

/** The slice of a BullMQ `Queue` the collector needs (fakeable in tests). */
export type MeteredQueue = {
  getJobCounts(): Promise<Record<string, number>>;
  getWaiting(start?: number, end?: number): Promise<Array<{ timestamp: number }>>;
};

export type MetricsSource = {
  enabled: boolean;
  queue(name: QueueName): MeteredQueue | null;
};

/** Reads depth and head-of-line age for every queue. A failing queue is skipped, not fatal. */
export async function collectQueueSnapshots(
  source: MetricsSource,
  now: () => number = Date.now,
): Promise<QueueSnapshot[]> {
  if (!source.enabled) return [];
  const out: QueueSnapshot[] = [];
  for (const name of Object.values(QUEUES)) {
    const q = source.queue(name);
    if (!q) continue;
    try {
      const [counts, head] = await Promise.all([q.getJobCounts(), q.getWaiting(0, 0)]);
      const first = head[0];
      out.push({
        queue: name,
        counts,
        oldestWaitingSeconds: first ? Math.max(0, (now() - first.timestamp) / 1000) : 0,
      });
    } catch {
      // Redis hiccup: omit this queue from the scrape; `ishan_queue_scrape_ok` reports it.
    }
  }
  return out;
}

/** In-process counters of jobs this worker finished, by queue and result. */
export class JobCounters {
  private readonly counts = new Map<string, number>();

  inc(queue: string, result: 'completed' | 'failed'): void {
    const k = `${queue}\u0000${result}`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }

  attach(worker: Pick<Worker, 'name' | 'on'>): void {
    worker.on('completed', () => this.inc(worker.name, 'completed'));
    worker.on('failed', () => this.inc(worker.name, 'failed'));
  }

  entries(): Array<{ queue: string; result: string; value: number }> {
    return [...this.counts].map(([k, value]) => {
      const [queue, result] = k.split('\u0000');
      return { queue: queue ?? '', result: result ?? '', value };
    });
  }
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

/** Prometheus text exposition format 0.0.4. Hand-written: three families do not justify a dependency. */
export function renderMetrics(input: {
  snapshots: QueueSnapshot[];
  expectedQueues: number;
  counters: JobCounters;
  workerUp: boolean;
}): string {
  const lines: string[] = [];
  const family = (name: string, type: 'gauge' | 'counter', help: string) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
  };

  family('ishan_worker_up', 'gauge', '1 while every worker in this process is running.');
  lines.push(`ishan_worker_up ${input.workerUp ? 1 : 0}`);

  family(
    'ishan_queue_scrape_ok',
    'gauge',
    '1 when every queue could be read from Redis during this scrape.',
  );
  lines.push(`ishan_queue_scrape_ok ${input.snapshots.length === input.expectedQueues ? 1 : 0}`);

  family('ishan_queue_jobs', 'gauge', 'Jobs per queue and state.');
  for (const s of input.snapshots) {
    for (const state of COUNTED_STATES) {
      const v = s.counts[state];
      if (v !== undefined)
        lines.push(`ishan_queue_jobs{queue="${esc(s.queue)}",state="${state}"} ${v}`);
    }
  }

  family(
    'ishan_queue_oldest_waiting_age_seconds',
    'gauge',
    'Age of the oldest job waiting to start; 0 when the queue has none.',
  );
  for (const s of input.snapshots) {
    lines.push(
      `ishan_queue_oldest_waiting_age_seconds{queue="${esc(s.queue)}"} ${s.oldestWaitingSeconds.toFixed(3)}`,
    );
  }

  family(
    'ishan_worker_jobs_processed_total',
    'counter',
    'Jobs finished by this worker process since it started.',
  );
  for (const e of input.counters.entries()) {
    lines.push(
      `ishan_worker_jobs_processed_total{queue="${esc(e.queue)}",result="${esc(e.result)}"} ${e.value}`,
    );
  }
  return lines.join('\n') + '\n';
}
