import { createServer, type Server } from 'node:http';

/**
 * The worker's only HTTP surface, bound to the internal network: container health and Prometheus
 * metrics. It must never be published (ADR 0019).
 */
export function createWorkerServer(deps: {
  isRunning: () => boolean;
  ping: () => Promise<boolean>;
  metrics: () => Promise<string>;
}): Server {
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/metrics') {
        try {
          const body = await deps.metrics();
          res.statusCode = 200;
          res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
          res.end(body);
        } catch {
          res.statusCode = 500;
          res.end('metrics unavailable\n');
        }
        return;
      }
      const ok = path === '/health/live' && deps.isRunning() && (await deps.ping());
      res.statusCode = ok ? 200 : path === '/health/live' ? 503 : 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error' }));
    })();
  });
}
