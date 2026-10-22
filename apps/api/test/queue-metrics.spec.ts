import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  collectQueueSnapshots,
  JobCounters,
  renderMetrics,
  type MeteredQueue,
} from '../src/infra/queue/queue-metrics';
import { QUEUES } from '../src/infra/queue/queues';
import { createWorkerServer } from '../src/jobs/worker-http';

const fake = (counts: Record<string, number>, headTs?: number): MeteredQueue => ({
  getJobCounts: async () => counts,
  getWaiting: async () => (headTs === undefined ? [] : [{ timestamp: headTs }]),
});

describe('collectQueueSnapshots', () => {
  it('reports depth and head-of-line age for every queue', async () => {
    const snaps = await collectQueueSnapshots(
      { enabled: true, queue: () => fake({ waiting: 3, active: 1 }, 10_000) },
      () => 25_000,
    );
    expect(snaps).toHaveLength(Object.keys(QUEUES).length);
    expect(snaps[0]).toMatchObject({ counts: { waiting: 3, active: 1 }, oldestWaitingSeconds: 15 });
  });

  it('is empty when Redis is not configured and age is 0 for an idle queue', async () => {
    expect(await collectQueueSnapshots({ enabled: false, queue: () => null })).toEqual([]);
    const [s] = await collectQueueSnapshots({ enabled: true, queue: () => fake({ waiting: 0 }) });
    expect(s?.oldestWaitingSeconds).toBe(0);
  });

  it('skips a queue that errors instead of failing the scrape', async () => {
    const bad: MeteredQueue = {
      getJobCounts: async () => Promise.reject(new Error('down')),
      getWaiting: async () => [],
    };
    let n = 0;
    const snaps = await collectQueueSnapshots({
      enabled: true,
      queue: () => (n++ === 0 ? bad : fake({ waiting: 1 })),
    });
    expect(snaps).toHaveLength(Object.keys(QUEUES).length - 1);
  });
});

describe('renderMetrics', () => {
  it('emits Prometheus text with labelled series and a scrape_ok flag', async () => {
    const counters = new JobCounters();
    counters.inc('events', 'completed');
    counters.inc('events', 'completed');
    counters.inc('webhooks', 'failed');
    const text = renderMetrics({
      snapshots: [
        { queue: 'events', counts: { waiting: 4, failed: 2 }, oldestWaitingSeconds: 1.5 },
      ],
      expectedQueues: 1,
      counters,
      workerUp: true,
    });
    expect(text).toContain('# TYPE ishan_queue_jobs gauge');
    expect(text).toContain('ishan_queue_jobs{queue="events",state="waiting"} 4');
    expect(text).toContain('ishan_queue_jobs{queue="events",state="failed"} 2');
    expect(text).toContain('ishan_queue_oldest_waiting_age_seconds{queue="events"} 1.500');
    expect(text).toContain(
      'ishan_worker_jobs_processed_total{queue="events",result="completed"} 2',
    );
    expect(text).toContain('ishan_worker_jobs_processed_total{queue="webhooks",result="failed"} 1');
    expect(text).toContain('ishan_queue_scrape_ok 1');
    expect(text).toContain('ishan_worker_up 1');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('flags a partial scrape and a stopped worker', () => {
    const text = renderMetrics({
      snapshots: [],
      expectedQueues: 5,
      counters: new JobCounters(),
      workerUp: false,
    });
    expect(text).toContain('ishan_queue_scrape_ok 0');
    expect(text).toContain('ishan_worker_up 0');
  });

  it('escapes label values', () => {
    const text = renderMetrics({
      snapshots: [{ queue: 'a"b\\c', counts: { waiting: 1 }, oldestWaitingSeconds: 0 }],
      expectedQueues: 1,
      counters: new JobCounters(),
      workerUp: true,
    });
    expect(text).toContain('queue="a\\"b\\\\c"');
  });
});

describe('worker HTTP server', () => {
  async function start(deps: Parameters<typeof createWorkerServer>[0]) {
    const server = createWorkerServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => new Promise((r) => server.close(r)) };
  }
  const ok = { isRunning: () => true, ping: async () => true, metrics: async () => 'm 1\n' };

  it('serves metrics as text/plain and keeps health semantics', async () => {
    const s = await start(ok);
    const m = await fetch(`${s.base}/metrics`);
    expect(m.status).toBe(200);
    expect(m.headers.get('content-type')).toContain('text/plain');
    expect(await m.text()).toBe('m 1\n');
    expect((await fetch(`${s.base}/health/live`)).status).toBe(200);
    expect((await fetch(`${s.base}/nope`)).status).toBe(404);
    expect((await fetch(`${s.base}/metrics`, { method: 'POST' })).status).toBe(404);
    await s.close();
  });

  it('health is 503 when Redis is down; metrics failure is a 500 without details', async () => {
    const s = await start({
      ...ok,
      ping: async () => false,
      metrics: async () => Promise.reject(new Error('secret detail')),
    });
    expect((await fetch(`${s.base}/health/live`)).status).toBe(503);
    const m = await fetch(`${s.base}/metrics`);
    expect(m.status).toBe(500);
    expect(await m.text()).not.toContain('secret');
    await s.close();
  });
});

const realRedis = process.env.RUN_DB_TESTS === '1' && process.env.REDIS_URL;
describe.skipIf(!realRedis)('collectQueueSnapshots (real Redis)', () => {
  it('sees a waiting job and its age on a live BullMQ queue', async () => {
    const { Queue } = await import('bullmq');
    const IORedis = (await import('ioredis')).default;
    const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const name = `metrics-test-${Date.now()}`;
    const q = new Queue(name, { connection });
    try {
      await q.add('noop', {});
      await new Promise((r) => setTimeout(r, 50));
      const [snap] = await collectQueueSnapshots({
        enabled: true,
        queue: (n) => (n === QUEUES.events ? (q as unknown as MeteredQueue) : null),
      });
      expect(snap?.counts.waiting).toBe(1);
      expect(snap?.oldestWaitingSeconds).toBeGreaterThan(0);
      expect(
        renderMetrics({
          snapshots: snap ? [snap] : [],
          expectedQueues: 1,
          counters: new JobCounters(),
          workerUp: true,
        }),
      ).toContain('ishan_queue_jobs{queue="events",state="waiting"} 1');
    } finally {
      await q.obliterate({ force: true }).catch(() => undefined);
      await q.close();
      connection.disconnect();
    }
  });
});
