import 'reflect-metadata';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Webhook API and delivery engine against a real PostgreSQL and a real local HTTP receiver (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Wh-Spec-Passw0rd';
const MISSING = '0197c0de-0000-7000-8000-000000000000';

interface Res {
  status: number;
  body: any;
  headers: Record<string, any>;
}
interface Received {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe.skipIf(!run)('webhooks (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let orgId = '';
  let otherOrgId = '';
  let deps: any;
  let signing: typeof import('../src/modules/webhooks/signing');
  let jobs: typeof import('../src/jobs/webhooks');
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'wh-admin': 'admin',
    'wh-manager': 'manager',
    'wh-sales': 'sales',
    'wh-viewer': 'viewer',
  };

  // --- local receiver -------------------------------------------------------------------------
  let server: http.Server;
  let base = '';
  let received: Received[] = [];
  /** Responses are consumed in order; an empty queue answers 200. */
  let replies: Array<{ status: number; headers?: Record<string, string> }> = [];

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    who: string | null,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Res> {
    const headers: Record<string, string> = { ...extra };
    if (who) headers.cookie = cookies[who]!;
    if (method !== 'GET') headers.origin = ORIGIN;
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = undefined;
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  const create = async (over: Record<string, unknown> = {}, who = 'wh-admin') => {
    const res = await call('POST', '/webhooks', who, {
      name: `hook-${randomUUID().slice(0, 8)}`,
      url: `${base}/hook`,
      eventTypes: ['deal.created'],
      ...over,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; secret: string; [k: string]: any };
  };

  const dealEvent = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    organizationId: orgId,
    type: 'deal.created',
    entityType: 'deal',
    entityId: randomUUID(),
    actorId: null,
    payload: {
      title: 'قرارداد الف',
      customerId: randomUUID(),
      stageId: randomUUID(),
      amount: '5000000',
      ownerId: null,
    },
    causedByRunId: null,
    occurredAt: new Date('2026-10-21T10:00:00.000Z'),
    ...over,
  });

  /** Event → handler → the delivery row for one endpoint. */
  async function dispatch(endpointId: string, event = dealEvent()) {
    const handler = jobs.createWebhookHandler({ prisma });
    await handler(event as any);
    return prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId, eventId: event.id } });
  }
  const deliver = (id: string, now?: Date) =>
    jobs.deliverWebhook({ ...deps, now: now && (() => now) }, id);
  const delivery = (id: string) => prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
  const MIN = 60_000;

  beforeAll(async () => {
    applyTestEnv({ WEBHOOK_ALLOW_INSECURE: 'true' });
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const r = replies.shift() ?? { status: 200 };
        res.writeHead(r.status, r.headers);
        res.end('receiver says hi');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { PasswordService } = await import('../src/modules/auth/password.service');
    const { CryptoService } = await import('../src/modules/auth/crypto.service');
    signing = await import('../src/modules/webhooks/signing');
    jobs = await import('../src/jobs/webhooks');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    deps = {
      prisma,
      crypto: app.get(CryptoService),
      guard: { allowLocal: true },
    };
    const hash = await app.get(PasswordService).hash(PASSWORD);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    orgId = org.id;
    for (const [name, key] of Object.entries(roleOf)) {
      const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key } });
      const user = await prisma.user.create({
        data: {
          organizationId: org.id,
          roleId: role.id,
          email: `${name}@example.com`,
          name,
          passwordHash: hash,
        },
      });
      ids[name] = user.id;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ORIGIN },
        payload: { email: `${name}@example.com`, password: PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      const raw = res.headers['set-cookie'];
      cookies[name] = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(';')[0]!;
    }
    otherOrgId = (await prisma.organization.create({ data: { name: 'wh-spec-other-org' } })).id;
  });

  beforeEach(async () => {
    received = [];
    replies = [];
    await prisma.webhookEndpoint.deleteMany({
      where: { OR: [{ createdById: { in: Object.values(ids) } }, { organizationId: otherOrgId }] },
    });
  });

  afterAll(async () => {
    if (prisma) {
      const all = Object.values(ids);
      await prisma.webhookEndpoint.deleteMany({
        where: { OR: [{ createdById: { in: all } }, { organizationId: otherOrgId }] },
      });
      // audit_logs is append-only by design; the rows stay.
      await prisma.user.deleteMany({ where: { id: { in: all } } });
      if (otherOrgId) await prisma.organization.delete({ where: { id: otherOrgId } });
    }
    await app?.close();
    await new Promise((r) => server?.close(r));
  });

  // --- access control ---------------------------------------------------------------------------
  it('requires authentication, and webhooks.* (admin only) for every endpoint', async () => {
    const endpoints: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]> = [
      ['GET', '/webhooks/catalog'],
      ['GET', '/webhooks'],
      [
        'POST',
        '/webhooks',
        { name: 'x-unauth', url: 'https://example.com/h', eventTypes: ['deal.created'] },
      ],
      ['GET', `/webhooks/${MISSING}`],
      ['PATCH', `/webhooks/${MISSING}`, { name: 'نام دیگر' }],
      ['POST', `/webhooks/${MISSING}/enable`],
      ['POST', `/webhooks/${MISSING}/disable`],
      ['POST', `/webhooks/${MISSING}/rotate-secret`],
      ['POST', `/webhooks/${MISSING}/test`],
      ['DELETE', `/webhooks/${MISSING}`],
      ['GET', `/webhooks/${MISSING}/deliveries`],
      ['POST', `/webhooks/deliveries/${MISSING}/redeliver`],
    ];
    for (const [m, url, body] of endpoints) {
      expect((await call(m, url, null, body)).status, `${m} ${url} anon`).toBe(401);
      for (const who of ['wh-manager', 'wh-sales', 'wh-viewer']) {
        expect((await call(m, url, who, body)).status, `${m} ${url} ${who}`).toBe(403);
      }
      const s = (await call(m, url, 'wh-admin', body)).status;
      // allowed → a business answer (404 for the missing id, 2xx/400/409 otherwise), never 401/403
      expect([200, 201, 202, 204, 400, 404, 409], `${m} ${url} admin`).toContain(s);
    }
  });

  it('serves the catalog from the shared contract', async () => {
    const res = await call('GET', '/webhooks/catalog', 'wh-admin');
    expect(res.status).toBe(200);
    expect(res.body.eventTypes).toContain('deal.stage_changed');
    expect(res.body).toMatchObject({ envelopeVersion: 1, maxAttempts: 7 });
  });

  // --- management -------------------------------------------------------------------------------
  it('creates an endpoint, shows the secret once, and never exposes it again', async () => {
    const w = await create();
    expect(w.secret).toMatch(/^whsec_/);
    expect(w).toMatchObject({
      enabled: true,
      secretHint: w.secret.slice(-4),
      consecutiveFailures: 0,
    });
    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: w.id } });
    expect(row.secretCiphertext).not.toContain(w.secret);
    expect(JSON.stringify(row)).not.toContain(w.secret);

    const got = await call('GET', `/webhooks/${w.id}`, 'wh-admin');
    const list = await call('GET', '/webhooks', 'wh-admin');
    for (const body of [got.body, list.body.items.find((i: any) => i.id === w.id)]) {
      expect(JSON.stringify(body)).not.toContain(w.secret);
      expect(
        Object.keys(body)
          .filter((k) => /secret/i.test(k))
          .sort(),
      ).toEqual(['previousSecretExpiresAt', 'secretHint']);
    }
    const audit = await prisma.auditLog.findMany({
      where: { action: 'webhook.created', entityId: w.id },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(w.secret);
  });

  it('rejects unsafe or malformed definitions with 400', async () => {
    const bad = async (over: Record<string, unknown>) =>
      call('POST', '/webhooks', 'wh-admin', {
        name: 'نامعتبر',
        url: `${base}/hook`,
        eventTypes: ['deal.created'],
        ...over,
      });
    expect((await bad({ url: 'http://example.com/h' })).status).toBe(400);
    expect((await bad({ url: 'https://10.0.0.5/h' })).status).toBe(400);
    const meta = await bad({ url: 'https://169.254.169.254/latest' });
    expect(meta.status).toBe(400);
    expect(meta.body.code ?? meta.body.error?.code).toBe('UNSAFE_WEBHOOK_URL');
    expect((await bad({ url: 'https://[fe80::1]/h' })).status).toBe(400);
    expect((await bad({ url: 'https://[::ffff:127.0.0.1]/h' })).status).toBe(400);
    expect((await bad({ url: 'https://u:p@example.com/h' })).status).toBe(400);
    expect((await bad({ url: 'http://10.0.0.5:8080/h' })).status).toBe(400); // allowLocal ≠ any private IP
    expect((await bad({ eventTypes: [] })).status).toBe(400);
    expect((await bad({ eventTypes: ['user.deleted'] })).status).toBe(400);
    expect((await bad({ eventTypes: ['deal.created', 'deal.created'] })).status).toBe(400);
    expect((await bad({ extra: 1 })).status).toBe(400);
    expect((await bad({ name: 'a' })).status).toBe(400);
    expect(await prisma.webhookEndpoint.count({ where: { name: 'نامعتبر' } })).toBe(0);
  });

  it('updates with If-Match (412 when stale), enables, disables and soft-deletes', async () => {
    const w = await create();
    const etag = (await call('GET', `/webhooks/${w.id}`, 'wh-admin')).headers.etag as string;
    const ok = await call(
      'PATCH',
      `/webhooks/${w.id}`,
      'wh-admin',
      { name: 'نام تازه', eventTypes: ['lead.created'] },
      { 'if-match': etag },
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'نام تازه', eventTypes: ['lead.created'] });
    const stale = await call(
      'PATCH',
      `/webhooks/${w.id}`,
      'wh-admin',
      { name: 'نام کهنه' },
      { 'if-match': etag },
    );
    expect(stale.status).toBe(412);
    expect(
      (await call('PATCH', `/webhooks/${w.id}`, 'wh-admin', { url: 'https://10.1.1.1/x' })).status,
    ).toBe(400);

    const off = await call('POST', `/webhooks/${w.id}/disable`, 'wh-admin');
    expect(off.body).toMatchObject({ enabled: false, disabledReason: 'MANUAL' });
    const on = await call('POST', `/webhooks/${w.id}/enable`, 'wh-admin');
    expect(on.body).toMatchObject({ enabled: true, disabledReason: null, consecutiveFailures: 0 });

    expect((await call('DELETE', `/webhooks/${w.id}`, 'wh-admin')).status).toBe(204);
    expect((await call('GET', `/webhooks/${w.id}`, 'wh-admin')).status).toBe(404);
    const actions = (
      await prisma.auditLog.findMany({ where: { entityId: w.id }, orderBy: { id: 'asc' } })
    ).map((a: any) => a.action);
    expect(actions).toEqual([
      'webhook.created',
      'webhook.updated',
      'webhook.disabled',
      'webhook.enabled',
      'webhook.deleted',
    ]);
  });

  it('caps the number of enabled endpoints at 20', async () => {
    for (let i = 0; i < 20; i++) await create();
    const res = await call('POST', '/webhooks', 'wh-admin', {
      name: 'بیست‌ویکم',
      url: `${base}/hook`,
      eventTypes: ['deal.created'],
    });
    expect(res.status).toBe(409);
    expect(res.body.code ?? res.body.error?.code).toBe('TOO_MANY_WEBHOOKS');
  });

  it("hides another organization's endpoints and deliveries (404, never 403)", async () => {
    const foreign = await prisma.webhookEndpoint.create({
      data: {
        organizationId: otherOrgId,
        name: 'foreign',
        url: 'https://example.com/h',
        eventTypes: ['deal.created'],
        secretCiphertext: 'x',
        secretHint: 'abcd',
        createdById: ids['wh-admin'],
      },
    });
    const foreignDelivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: foreign.id,
        eventType: 'deal.created',
        payload: {},
        nextAttemptAt: new Date(),
      },
    });
    for (const [m, url, body] of [
      ['GET', `/webhooks/${foreign.id}`],
      ['PATCH', `/webhooks/${foreign.id}`, { name: 'hijack' }],
      ['POST', `/webhooks/${foreign.id}/enable`],
      ['POST', `/webhooks/${foreign.id}/disable`],
      ['POST', `/webhooks/${foreign.id}/rotate-secret`],
      ['POST', `/webhooks/${foreign.id}/test`],
      ['GET', `/webhooks/${foreign.id}/deliveries`],
      ['DELETE', `/webhooks/${foreign.id}`],
      ['POST', `/webhooks/deliveries/${foreignDelivery.id}/redeliver`],
    ] as Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]>) {
      expect((await call(m, url, 'wh-admin', body)).status, `${m} ${url}`).toBe(404);
    }
    const list = await call('GET', '/webhooks', 'wh-admin');
    expect(list.body.items.find((i: any) => i.id === foreign.id)).toBeUndefined();
    expect(
      (await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: foreign.id } })).name,
    ).toBe('foreign');
  });

  // --- event → delivery ------------------------------------------------------------------------
  it('queues one delivery per subscribed, enabled endpoint of the same organization — idempotently', async () => {
    const mine = await create({ eventTypes: ['deal.created'] });
    const other = await create({ eventTypes: ['lead.created'] });
    const off = await create({ eventTypes: ['deal.created'] });
    await call('POST', `/webhooks/${off.id}/disable`, 'wh-admin');
    const foreign = await prisma.webhookEndpoint.create({
      data: {
        organizationId: otherOrgId,
        name: 'foreign',
        url: `${base}/hook`,
        eventTypes: ['deal.created'],
        secretCiphertext: 'x',
        secretHint: 'abcd',
        createdById: ids['wh-admin'],
      },
    });
    const event = dealEvent();
    const queued: Array<{ id: string; attempt: number }> = [];
    const handler = jobs.createWebhookHandler({
      prisma,
      enqueue: async (items) => {
        queued.push(...items);
      },
    });
    await handler(event as any);
    await handler(event as any); // re-dispatch of the same event
    const rows = await prisma.webhookDelivery.findMany({ where: { eventId: event.id } });
    expect(rows.map((r: any) => r.endpointId)).toEqual([mine.id]);
    expect(queued).toEqual([{ id: rows[0].id, attempt: 0 }]);
    expect(rows[0]).toMatchObject({ status: 'PENDING', attempt: 0, eventType: 'deal.created' });
    expect(rows[0].payload).toEqual({
      id: event.id,
      type: 'deal.created',
      version: 1,
      occurredAt: '2026-10-21T10:00:00.000Z',
      organizationId: orgId,
      entity: { type: 'deal', id: event.entityId },
      data: event.payload,
    });
    expect(
      await prisma.webhookDelivery.count({
        where: { endpointId: { in: [other.id, off.id, foreign.id] } },
      }),
    ).toBe(0);
  });

  it('survives a queue outage when enqueueing (the sweeper picks the delivery up)', async () => {
    const w = await create();
    const event = dealEvent();
    const handler = jobs.createWebhookHandler({
      prisma,
      enqueue: async () => {
        throw new Error('redis down');
      },
      log: { info: () => undefined, error: () => undefined },
    });
    await handler(event as any);
    const d = await delivery(
      (await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: w.id } })).id,
    );
    expect(d.status).toBe('PENDING');
    const due = await jobs.findDueDeliveries(prisma, new Date(Date.now() + 1000));
    expect(due.map((x) => x.id)).toContain(d.id);
  });

  // --- delivery ---------------------------------------------------------------------------------
  it('delivers a signed request the receiver can verify', async () => {
    const w = await create();
    const event = dealEvent();
    const d = await dispatch(w.id, event);
    expect(await deliver(d.id)).toBe('succeeded');

    expect(received).toHaveLength(1);
    const r = received[0]!;
    expect(r.url).toBe('/hook');
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['x-ishan-event']).toBe('deal.created');
    expect(r.headers['x-ishan-delivery']).toBe(d.id);
    expect(signing.verifySignature(w.secret, String(r.headers['x-ishan-signature']), r.body)).toBe(
      true,
    );
    expect(
      signing.verifySignature('whsec_wrong', String(r.headers['x-ishan-signature']), r.body),
    ).toBe(false);
    expect(JSON.parse(r.body)).toMatchObject({
      id: event.id,
      type: 'deal.created',
      data: { title: 'قرارداد الف' },
    });

    const done = await delivery(d.id);
    expect(done).toMatchObject({
      status: 'SUCCEEDED',
      attempt: 1,
      nextAttemptAt: null,
      lastStatusCode: 200,
      lastError: null,
      responseSnippet: 'receiver says hi',
    });
    expect(done.deliveredAt).toBeInstanceOf(Date);
    // finished deliveries are never sent twice
    expect(await deliver(d.id)).toBe('skipped');
    expect(received).toHaveLength(1);
  });

  it('retries with the documented backoff and fails for good after 7 attempts', async () => {
    const w = await create();
    const d = await dispatch(w.id);
    let clock = new Date();
    const waits = [1, 5, 30, 120, 360, 1440];
    for (let attempt = 1; attempt <= 6; attempt++) {
      replies.push({ status: 500 });
      expect(await deliver(d.id, clock), `attempt ${attempt}`).toBe('retry');
      const row = await delivery(d.id);
      expect(row).toMatchObject({
        status: 'PENDING',
        attempt,
        lastStatusCode: 500,
        lastError: 'HTTP 500',
      });
      expect(row.nextAttemptAt.getTime()).toBe(clock.getTime() + waits[attempt - 1]! * MIN);
      // not due yet → nothing is sent
      expect(
        await deliver(d.id, new Date(clock.getTime() + waits[attempt - 1]! * MIN - 1000)),
      ).toBe('skipped');
      clock = row.nextAttemptAt;
    }
    replies.push({ status: 503 });
    expect(await deliver(d.id, clock)).toBe('failed');
    expect(await delivery(d.id)).toMatchObject({
      status: 'FAILED',
      attempt: 7,
      nextAttemptAt: null,
      lastStatusCode: 503,
    });
    expect(received).toHaveLength(7);
    expect(
      (await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: w.id } })).consecutiveFailures,
    ).toBe(1);
  });

  it('a success resets the failure counter', async () => {
    const w = await create();
    await prisma.webhookEndpoint.update({ where: { id: w.id }, data: { consecutiveFailures: 4 } });
    expect(await deliver((await dispatch(w.id)).id)).toBe('succeeded');
    expect(
      (await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: w.id } })).consecutiveFailures,
    ).toBe(0);
  });

  it('does not follow redirects', async () => {
    const w = await create();
    replies.push({ status: 302, headers: { location: `${base}/elsewhere` } });
    const d = await dispatch(w.id);
    expect(await deliver(d.id)).toBe('retry');
    expect(await delivery(d.id)).toMatchObject({ lastStatusCode: 302, lastError: 'HTTP 302' });
    expect(received.map((r) => r.url)).toEqual(['/hook']);
  });

  it('re-checks the target at send time (DNS/DB tampering cannot reach the internal network)', async () => {
    const w = await create();
    const d = await dispatch(w.id);
    await prisma.webhookEndpoint.update({
      where: { id: w.id },
      data: { url: 'https://10.0.0.5/steal' },
    });
    expect(await deliver(d.id)).toBe('retry');
    const row = await delivery(d.id);
    expect(row.lastStatusCode).toBeNull();
    expect(row.lastError).toContain('شبکه‌ی داخلی');
    expect(received).toHaveLength(0);
  });

  it('records a connection error and keeps going', async () => {
    const w = await create();
    const d = await dispatch(w.id);
    const dead = http.createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const port = (dead.address() as AddressInfo).port;
    await new Promise((r) => dead.close(r));
    await prisma.webhookEndpoint.update({
      where: { id: w.id },
      data: { url: `http://127.0.0.1:${port}/x` },
    });
    expect(await deliver(d.id)).toBe('retry');
    expect((await delivery(d.id)).lastError).toMatch(/ECONNREFUSED/);
  });

  it('fails a delivery whose endpoint was disabled or deleted meanwhile, without sending', async () => {
    const w = await create();
    const d1 = await dispatch(w.id, dealEvent());
    await call('POST', `/webhooks/${w.id}/disable`, 'wh-admin');
    expect(await deliver(d1.id)).toBe('failed');
    expect(await delivery(d1.id)).toMatchObject({ status: 'FAILED', nextAttemptAt: null });

    await call('POST', `/webhooks/${w.id}/enable`, 'wh-admin');
    const d2 = await dispatch(w.id, dealEvent());
    await call('DELETE', `/webhooks/${w.id}`, 'wh-admin');
    expect(await deliver(d2.id)).toBe('failed');
    expect(received).toHaveLength(0);
    expect(
      (await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: w.id } })).consecutiveFailures,
    ).toBe(0);
  });

  it('two workers racing for the same delivery send it once', async () => {
    const w = await create();
    const d = await dispatch(w.id);
    const outcomes = await Promise.all([deliver(d.id), deliver(d.id), deliver(d.id)]);
    expect(outcomes.filter((o) => o !== 'skipped')).toEqual(['succeeded']);
    expect(received).toHaveLength(1);
  });

  it('switches an endpoint off after 10 failed deliveries in a row and tells its creator', async () => {
    const w = await create();
    await prisma.webhookEndpoint.update({ where: { id: w.id }, data: { consecutiveFailures: 9 } });
    const d = await dispatch(w.id);
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempt: 6 } });
    replies.push({ status: 500 });
    expect(await deliver(d.id)).toBe('failed');

    const ep = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: w.id } });
    expect(ep).toMatchObject({
      enabled: false,
      disabledReason: 'AUTO_FAILURES',
      consecutiveFailures: 10,
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'webhook.auto_disabled', entityId: w.id } }),
    ).toBe(1);
    const note = await prisma.notification.findFirstOrThrow({
      where: { entityType: 'webhook', entityId: w.id },
    });
    expect(note).toMatchObject({ userId: ids['wh-admin'], type: 'system' });
    expect(note.title).toContain(ep.name);

    // no new deliveries while off; turning it back on clears the counter
    const e2 = dealEvent();
    await jobs.createWebhookHandler({ prisma })(e2 as any);
    expect(await prisma.webhookDelivery.count({ where: { eventId: e2.id } })).toBe(0);
    const on = await call('POST', `/webhooks/${w.id}/enable`, 'wh-admin');
    expect(on.body).toMatchObject({ enabled: true, disabledReason: null, consecutiveFailures: 0 });
  });

  // --- secrets -----------------------------------------------------------------------------------
  it('rotates the secret with a 24 h overlap during which both secrets sign', async () => {
    const w = await create();
    const rotated = await call('POST', `/webhooks/${w.id}/rotate-secret`, 'wh-admin');
    expect(rotated.status).toBe(200);
    expect(rotated.body.secret).toMatch(/^whsec_/);
    expect(rotated.body.secret).not.toBe(w.secret);
    expect(rotated.body.previousSecretExpiresAt).toBeTruthy();

    const d1 = await dispatch(w.id, dealEvent());
    expect(await deliver(d1.id)).toBe('succeeded');
    const sig = String(received[0]!.headers['x-ishan-signature']);
    expect(sig.match(/v1=/g)).toHaveLength(2);
    expect(signing.verifySignature(rotated.body.secret, sig, received[0]!.body)).toBe(true);
    expect(signing.verifySignature(w.secret, sig, received[0]!.body)).toBe(true);

    // 25 h later the old secret has stopped signing
    const d2 = await dispatch(w.id, dealEvent());
    const later = new Date(Date.now() + 25 * 60 * MIN);
    expect(await deliver(d2.id, later)).toBe('succeeded');
    const sig2 = String(received[1]!.headers['x-ishan-signature']);
    expect(sig2.match(/v1=/g)).toHaveLength(1);
    const at = Math.floor(later.getTime() / 1000);
    expect(signing.verifySignature(rotated.body.secret, sig2, received[1]!.body, at)).toBe(true);
    expect(signing.verifySignature(w.secret, sig2, received[1]!.body, at)).toBe(false);
    expect((await call('GET', `/webhooks/${w.id}`, 'wh-admin')).body.secretHint).toBe(
      rotated.body.secret.slice(-4),
    );
  });

  // --- ping, history, redelivery ---------------------------------------------------------------
  it('sends a test ping once, never retries it and does not count it as a failure', async () => {
    const w = await create();
    const ping = await call('POST', `/webhooks/${w.id}/test`, 'wh-admin');
    expect(ping.status).toBe(202);
    expect(ping.body).toMatchObject({
      eventType: 'webhook.test',
      status: 'PENDING',
      eventId: null,
    });
    expect(await deliver(ping.body.id)).toBe('succeeded');
    expect(JSON.parse(received[0]!.body)).toMatchObject({
      type: 'webhook.test',
      entity: { type: 'webhook', id: w.id },
    });

    replies.push({ status: 500 });
    const ping2 = await call('POST', `/webhooks/${w.id}/test`, 'wh-admin');
    expect(await deliver(ping2.body.id)).toBe('failed');
    expect(await delivery(ping2.body.id)).toMatchObject({ status: 'FAILED', attempt: 1 });
    expect(
      (await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: w.id } })).consecutiveFailures,
    ).toBe(0);

    await call('POST', `/webhooks/${w.id}/disable`, 'wh-admin');
    expect((await call('POST', `/webhooks/${w.id}/test`, 'wh-admin')).status).toBe(409);
  });

  it('lists deliveries newest first with a status filter, and redelivers on demand', async () => {
    const w = await create();
    const d1 = await dispatch(w.id, dealEvent());
    await deliver(d1.id);
    replies.push({ status: 500 });
    const d2 = await dispatch(w.id, dealEvent());
    await deliver(d2.id);

    const all = await call('GET', `/webhooks/${w.id}/deliveries`, 'wh-admin');
    expect(all.body.items.map((i: any) => i.id)).toEqual([d2.id, d1.id]);
    expect(all.body.items[0]).not.toHaveProperty('payload');
    const ok = await call('GET', `/webhooks/${w.id}/deliveries?status=SUCCEEDED`, 'wh-admin');
    expect(ok.body.items.map((i: any) => i.id)).toEqual([d1.id]);
    const page = await call('GET', `/webhooks/${w.id}/deliveries?limit=1`, 'wh-admin');
    expect(page.body.nextCursor).toBe(d2.id);
    expect(
      (await call('GET', `/webhooks/${w.id}/deliveries?status=BOGUS`, 'wh-admin')).status,
    ).toBe(400);

    const again = await call('POST', `/webhooks/deliveries/${d1.id}/redeliver`, 'wh-admin');
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({
      status: 'PENDING',
      attempt: 0,
      eventType: 'deal.created',
      eventId: null,
    });
    expect(again.body.id).not.toBe(d1.id);
    const copy = await delivery(again.body.id);
    expect(copy.payload).toEqual((await delivery(d1.id)).payload);
    expect(await deliver(again.body.id)).toBe('succeeded');
    expect(
      await prisma.auditLog.count({ where: { action: 'webhook.redelivered', entityId: w.id } }),
    ).toBe(1);

    await call('POST', `/webhooks/${w.id}/disable`, 'wh-admin');
    expect((await call('POST', `/webhooks/deliveries/${d1.id}/redeliver`, 'wh-admin')).status).toBe(
      409,
    );
  });

  // --- maintenance ------------------------------------------------------------------------------
  it('sweeps due deliveries only, and purges only old finished ones', async () => {
    const w = await create();
    const now = new Date('2026-11-01T00:00:00.000Z');
    const mk = (data: Record<string, unknown>) =>
      prisma.webhookDelivery.create({
        data: { endpointId: w.id, eventType: 'deal.created', payload: {}, ...data },
      });
    const due = await mk({ nextAttemptAt: new Date(now.getTime() - MIN), attempt: 2 });
    const future = await mk({ nextAttemptAt: new Date(now.getTime() + MIN) });
    const oldDone = await mk({
      status: 'SUCCEEDED',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const oldFailed = await mk({
      status: 'FAILED',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const oldPending = await mk({
      nextAttemptAt: new Date(now.getTime() + MIN),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const freshDone = await mk({
      status: 'SUCCEEDED',
      createdAt: new Date('2026-10-30T00:00:00.000Z'),
    });

    expect(await jobs.findDueDeliveries(prisma, now)).toEqual([{ id: due.id, attempt: 2 }]);
    expect(await jobs.purgeWebhookDeliveries(prisma, now, 30)).toBe(2);
    const left = (await prisma.webhookDelivery.findMany({ where: { endpointId: w.id } }))
      .map((d: any) => d.id)
      .sort();
    expect(left).toEqual([due.id, future.id, oldPending.id, freshDone.id].sort());
    expect(left).not.toContain(oldDone.id);
    expect(left).not.toContain(oldFailed.id);
  });

  it('keeps database invariants the application could otherwise break', async () => {
    const w = await create();
    const attempt = (data: Record<string, unknown>) =>
      prisma.webhookDelivery.create({
        data: { endpointId: w.id, eventType: 'deal.created', payload: {}, ...data },
      });
    await expect(attempt({ status: 'WEIRD', nextAttemptAt: new Date() })).rejects.toThrow();
    await expect(attempt({ status: 'PENDING' })).rejects.toThrow(); // pending needs a due time
    await expect(attempt({ status: 'FAILED', nextAttemptAt: new Date() })).rejects.toThrow();
    await expect(attempt({ attempt: 8, status: 'FAILED' })).rejects.toThrow();
    await expect(
      prisma.webhookEndpoint.update({ where: { id: w.id }, data: { eventTypes: [] } }),
    ).rejects.toThrow();
    await expect(
      prisma.webhookEndpoint.update({ where: { id: w.id }, data: { eventTypes: ['nope'] } }),
    ).rejects.toThrow();
    const e = dealEvent();
    await attempt({ eventId: e.id, nextAttemptAt: new Date() });
    await expect(attempt({ eventId: e.id, nextAttemptAt: new Date() })).rejects.toThrow(); // UNIQUE
  });
});
