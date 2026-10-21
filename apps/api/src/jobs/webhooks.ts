import http from 'node:http';
import https from 'node:https';
import type { Job } from 'bullmq';
import {
  WEBHOOK_AUTO_DISABLE_AFTER,
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_RESPONSE_SNIPPET_CHARS,
  WEBHOOK_TEST_EVENT_TYPE,
  WEBHOOK_TIMEOUT_MS,
  buildWebhookEnvelope,
  webhookRetryDelayMinutes,
} from '@ishan/contracts';
import type { PrismaService } from '../infra/prisma.service';
import type { QueueService } from '../infra/queue/queue.service';
import { QUEUES, WEBHOOK_JOBS } from '../infra/queue/queues';
import type { CryptoService } from '../modules/auth/crypto.service';
import { signatureHeader } from '../modules/webhooks/signing';
import {
  resolveSafeTarget,
  UnsafeTargetError,
  type GuardOptions,
  type ResolvedTarget,
} from '../modules/webhooks/url-guard';
import type { DispatchedEvent, EventHandler } from './events';

/** A claimed attempt that never reports back (worker crash) becomes due again after this long. */
export const DELIVERY_LEASE_MS = 2 * 60_000;
const SWEEP_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WebhookRequest {
  target: ResolvedTarget;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
export interface WebhookResponse {
  status: number;
  snippet: string;
}
/** Injectable so tests can fake the network; production uses {@link httpSender}. */
export type WebhookSender = (req: WebhookRequest) => Promise<WebhookResponse>;

/**
 * Sends one POST to the already-validated address. The connection is pinned to `target.address`
 * (custom `lookup`), TLS still verifies the original host name, redirects are NOT followed, and
 * at most 1 MiB of the response is read.
 */
export const httpSender: WebhookSender = (req) =>
  new Promise((resolve, reject) => {
    const { url, address, family } = req.target;
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: 'POST',
        agent: false,
        timeout: req.timeoutMs,
        servername: url.protocol === 'https:' ? url.hostname.replace(/^\[|\]$/g, '') : undefined,
        lookup: (_host, _opts, cb) => (cb as (...a: unknown[]) => void)(null, address, family),
        headers: { ...req.headers, 'content-length': Buffer.byteLength(req.body) },
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > WEBHOOK_MAX_RESPONSE_BYTES) {
            request.destroy(new Error('پاسخ بیش از حد بزرگ است'));
            return;
          }
          if (Buffer.concat(chunks).length < WEBHOOK_RESPONSE_SNIPPET_CHARS * 4) chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            snippet: Buffer.concat(chunks)
              .toString('utf8')
              .slice(0, WEBHOOK_RESPONSE_SNIPPET_CHARS),
          }),
        );
        res.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('مهلت پاسخ تمام شد')));
    request.on('error', reject);
    request.end(req.body);
  });

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

export interface Logger {
  info: (o: object, m: string) => void;
  error: (o: object, m: string) => void;
}

/** Hands delivery ids to the `webhooks` queue. A duplicate add (same id and attempt) is ignored. */
export async function publishDeliveries(
  queues: QueueService,
  items: Array<{ id: string; attempt: number }>,
): Promise<void> {
  const queue = queues.queue(QUEUES.webhooks);
  if (!queue || items.length === 0) return;
  await queue.addBulk(
    items.map((i) => ({
      name: WEBHOOK_JOBS.deliver,
      data: { deliveryId: i.id },
      // Retries are driven by the database (next_attempt_at), never by BullMQ attempts.
      opts: {
        jobId: `${i.id}_${i.attempt}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    })),
  );
}

export interface EnqueueDeps {
  prisma: Pick<PrismaService, 'webhookEndpoint' | 'webhookDelivery'>;
  /** Queue the new deliveries; failures are fine because the sweeper re-queues due ones. */
  enqueue?: (items: Array<{ id: string; attempt: number }>) => Promise<void>;
  now?: () => Date;
  log?: Logger;
}

/**
 * Event handler (runs after the workflow handler in the `events` worker): one PENDING delivery
 * per enabled endpoint subscribed to the event type. UNIQUE (endpoint_id, event_id) makes a
 * re-dispatch harmless. The envelope is snapshotted so retries survive event purging.
 */
export function createWebhookHandler(deps: EnqueueDeps): EventHandler {
  return async (event: DispatchedEvent) => {
    const endpoints = await deps.prisma.webhookEndpoint.findMany({
      where: {
        organizationId: event.organizationId,
        enabled: true,
        deletedAt: null,
        eventTypes: { has: event.type },
      },
      select: { id: true },
    });
    if (endpoints.length === 0) return;
    const envelope = buildWebhookEnvelope(event);
    const created: Array<{ id: string; attempt: number }> = [];
    for (const ep of endpoints) {
      try {
        const row = await deps.prisma.webhookDelivery.create({
          data: {
            endpointId: ep.id,
            eventId: event.id,
            eventType: event.type,
            payload: envelope as never,
            nextAttemptAt: (deps.now ?? (() => new Date()))(),
          },
          select: { id: true },
        });
        created.push({ id: row.id, attempt: 0 });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    try {
      await deps.enqueue?.(created);
    } catch (err) {
      deps.log?.error({ err: String(err) }, 'could not queue webhook deliveries; sweeper will');
    }
  };
}

export interface DeliverDeps {
  prisma: Pick<PrismaService, 'webhookDelivery' | 'webhookEndpoint' | 'auditLog' | 'notification'>;
  crypto: Pick<CryptoService, 'decrypt'>;
  guard: GuardOptions;
  send?: WebhookSender;
  now?: () => Date;
  log?: Logger;
}

export type DeliverOutcome = 'skipped' | 'succeeded' | 'retry' | 'failed';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * One attempt. Safe to call twice at once: the attempt is claimed with a conditional UPDATE
 * that also leases the row, so only one caller proceeds. Never throws for delivery problems;
 * those are recorded on the row and retried by schedule. Unexpected errors (database down)
 * propagate, and the lease expiry makes the sweeper pick the delivery up again.
 */
export async function deliverWebhook(
  deps: DeliverDeps,
  deliveryId: string,
): Promise<DeliverOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await deps.prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: 'PENDING', nextAttemptAt: { lte: now } },
    data: { attempt: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS) },
  });
  if (claimed.count === 0) return 'skipped';

  const delivery = await deps.prisma.webhookDelivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  const ep = delivery.endpoint;
  const finish = (data: Record<string, unknown>) =>
    deps.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: data as never });

  if (ep.deletedAt || !ep.enabled) {
    await finish({
      status: 'FAILED',
      nextAttemptAt: null,
      lastError: 'آدرس وب‌هوک غیرفعال یا حذف شده است',
    });
    return 'failed';
  }

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(now.getTime() / 1000);
  const secrets = [deps.crypto.decrypt(ep.secretCiphertext)];
  if (
    ep.previousSecretCiphertext &&
    ep.previousSecretExpiresAt &&
    ep.previousSecretExpiresAt > now
  ) {
    secrets.push(deps.crypto.decrypt(ep.previousSecretCiphertext));
  }

  let statusCode: number | null = null;
  let snippet: string | null = null;
  let error: string | null = null;
  const started = Date.now();
  try {
    const target = await resolveSafeTarget(ep.url, deps.guard);
    const res = await (deps.send ?? httpSender)({
      target,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      body,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Ishan-CRM-Webhooks/1',
        'x-ishan-event': delivery.eventType,
        'x-ishan-delivery': delivery.id,
        'x-ishan-signature': signatureHeader(secrets, timestamp, body),
      },
    });
    statusCode = res.status;
    snippet = res.snippet || null;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error =
      err instanceof UnsafeTargetError
        ? err.message
        : oneLine(String((err as Error)?.message ?? err));
  }
  const durationMs = Date.now() - started;

  if (!error) {
    await finish({
      status: 'SUCCEEDED',
      nextAttemptAt: null,
      lastStatusCode: statusCode,
      lastError: null,
      responseSnippet: snippet,
      durationMs,
      deliveredAt: now,
    });
    if (ep.consecutiveFailures > 0) {
      await deps.prisma.webhookEndpoint.update({
        where: { id: ep.id },
        data: { consecutiveFailures: 0 },
      });
    }
    return 'succeeded';
  }

  // Test pings are a single shot; real events follow the backoff table.
  const isPing = delivery.eventType === WEBHOOK_TEST_EVENT_TYPE;
  const delay = isPing ? null : webhookRetryDelayMinutes(delivery.attempt);
  const failure = {
    lastStatusCode: statusCode,
    lastError: error,
    responseSnippet: snippet,
    durationMs,
  };
  if (delay !== null) {
    await finish({ ...failure, nextAttemptAt: new Date(now.getTime() + delay * 60_000) });
    return 'retry';
  }
  await finish({ ...failure, status: 'FAILED', nextAttemptAt: null });
  if (!isPing) await countFinalFailure(deps, ep, now);
  return 'failed';
}

/** A delivery ran out of attempts: after enough in a row the endpoint is switched off. */
async function countFinalFailure(
  deps: DeliverDeps,
  ep: { id: string; organizationId: string; name: string; createdById: string },
  now: Date,
) {
  const updated = await deps.prisma.webhookEndpoint.update({
    where: { id: ep.id },
    data: { consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true },
  });
  if (updated.consecutiveFailures < WEBHOOK_AUTO_DISABLE_AFTER) return;
  const off = await deps.prisma.webhookEndpoint.updateMany({
    where: { id: ep.id, enabled: true },
    data: { enabled: false, disabledReason: 'AUTO_FAILURES' },
  });
  if (off.count === 0) return;
  await deps.prisma.auditLog.create({
    data: {
      organizationId: ep.organizationId,
      actorId: null,
      action: 'webhook.auto_disabled',
      entityType: 'webhook',
      entityId: ep.id,
      metadata: { name: ep.name, failures: updated.consecutiveFailures } as never,
    },
  });
  await deps.prisma.notification
    .create({
      data: {
        userId: ep.createdById,
        type: 'system',
        title: `وب‌هوک «${ep.name}» به‌دلیل خطاهای پیاپی خاموش شد`.slice(0, 200),
        body: 'آدرس مقصد را بررسی کنید و پس از رفع مشکل دوباره روشنش کنید.',
        entityType: 'webhook',
        entityId: ep.id,
      },
    })
    .catch((err) =>
      deps.log?.error({ err: String(err) }, 'could not notify about auto-disabled webhook'),
    );
  deps.log?.info({ endpointId: ep.id, at: now.toISOString() }, 'webhook endpoint auto-disabled');
}

/** Processor of the `webhooks` queue. */
export function createWebhookProcessor(deps: DeliverDeps) {
  return async (job: Job): Promise<{ outcome: DeliverOutcome }> => {
    if (job.name !== WEBHOOK_JOBS.deliver) throw new Error(`Unknown webhook job: ${job.name}`);
    const { deliveryId } = job.data as { deliveryId?: string };
    if (!deliveryId) throw new Error('deliver-webhook needs a deliveryId');
    return { outcome: await deliverWebhook(deps, deliveryId) };
  };
}

/** Deliveries whose time has come (first attempt not yet queued, a retry, or an expired lease). */
export async function findDueDeliveries(
  prisma: Pick<PrismaService, 'webhookDelivery'>,
  now: Date,
): Promise<Array<{ id: string; attempt: number }>> {
  return prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true, attempt: true },
  });
}

/** Deletes finished deliveries older than `retentionDays`. Pending ones are never purged. */
export async function purgeWebhookDeliveries(
  prisma: Pick<PrismaService, 'webhookDelivery'>,
  now: Date,
  retentionDays: number,
): Promise<number> {
  const res = await prisma.webhookDelivery.deleteMany({
    where: {
      status: { in: ['SUCCEEDED', 'FAILED'] },
      createdAt: { lt: new Date(now.getTime() - retentionDays * DAY_MS) },
    },
  });
  return res.count;
}
