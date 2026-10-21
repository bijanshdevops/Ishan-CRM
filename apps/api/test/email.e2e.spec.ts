import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** E-mail channel against a real PostgreSQL and an in-process SMTP server (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Em-Spec-Passw0rd';
const MISSING = '0197c0de-0000-7000-8000-000000000000';

interface Res {
  status: number;
  body: any;
}
interface Mail {
  to: string[];
  data: string;
}

describe.skipIf(!run)('email notifications (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let jobs: typeof import('../src/jobs/emails');
  let outbox: typeof import('../src/modules/notifications/email-outbox');
  let deps: any;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'em-admin': 'admin',
    'em-manager': 'manager',
    'em-sales': 'sales',
    'em-viewer': 'viewer',
  };

  let smtp: SMTPServer;
  let inbox: Mail[] = [];
  /** SMTP reply codes consumed in order for each DATA command; empty = accept. */
  let rejects: number[] = [];

  async function call(
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    who: string | null,
    body?: unknown,
  ): Promise<Res> {
    const headers: Record<string, string> = {};
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
    return { status: res.statusCode, body: parsed };
  }

  const optIn = (who: string, enabled = true) =>
    prisma.notificationPreference.upsert({
      where: { userId: ids[who] },
      create: { userId: ids[who], emailEnabled: enabled },
      update: { emailEnabled: enabled },
    });

  /** A notification with its queued, due e-mail; returns the delivery id. */
  async function queued(who: string, title = 'Hello'): Promise<{ id: string; nid: string }> {
    const n = await prisma.notification.create({
      data: { userId: ids[who], type: 'workflow', title, body: 'body' },
    });
    const ok = await outbox.queueNotificationEmail(
      prisma,
      { id: n.id, userId: ids[who]! },
      new Date(Date.now() - 1000),
    );
    expect(ok).toBe(true);
    const d = await prisma.emailDelivery.findUniqueOrThrow({ where: { notificationId: n.id } });
    return { id: d.id, nid: n.id };
  }

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, session, cb) {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          const code = rejects.shift();
          if (code) {
            const err: any = new Error(`rejected ${code}`);
            err.responseCode = code;
            return cb(err);
          }
          inbox.push({
            to: session.envelope.rcptTo.map((r) => r.address),
            data: Buffer.concat(chunks).toString('utf8'),
          });
          cb();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
    const port = (smtp.server.address() as AddressInfo).port;
    applyTestEnv({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_ALLOW_INSECURE: 'true',
      EMAIL_FROM: 'Ishan <noreply@example.com>',
      APP_BASE_URL: 'https://crm.example.com',
    });
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { PasswordService } = await import('../src/modules/auth/password.service');
    const { loadConfig } = await import('../src/config');
    jobs = await import('../src/jobs/emails');
    outbox = await import('../src/modules/notifications/email-outbox');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    const config = loadConfig(process.env);
    deps = { prisma, transport: jobs.createSmtpTransport(config), config };
    const hash = await app.get(PasswordService).hash(PASSWORD);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
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
  });

  beforeEach(() => {
    inbox = [];
    rejects = [];
  });

  afterAll(async () => {
    if (prisma) {
      const all = Object.values(ids);
      await prisma.notification.deleteMany({ where: { userId: { in: all } } });
      await prisma.notificationPreference.deleteMany({ where: { userId: { in: all } } });
      await prisma.user.deleteMany({ where: { id: { in: all } } });
    }
    await app?.close();
    await new Promise<void>((r) => smtp?.close(() => r()));
  });

  // --- API ------------------------------------------------------------------------------------
  it('requires authentication on every endpoint', async () => {
    expect((await call('GET', '/account/notification-preferences', null)).status).toBe(401);
    expect(
      (await call('PUT', '/account/notification-preferences', null, { emailEnabled: true })).status,
    ).toBe(401);
    expect((await call('POST', '/account/notification-email/test', null)).status).toBe(401);
  });

  it('lets every role manage only its own preference, off by default', async () => {
    for (const who of Object.keys(roleOf)) {
      const before = await call('GET', '/account/notification-preferences', who);
      expect(before.status).toBe(200);
      expect(before.body).toEqual({
        emailAvailable: true,
        emailEnabled: false,
        email: `${who}@example.com`,
      });
    }
    const on = await call('PUT', '/account/notification-preferences', 'em-sales', {
      emailEnabled: true,
    });
    expect(on.status).toBe(200);
    expect(on.body.emailEnabled).toBe(true);
    // Nobody else is affected.
    expect(
      (await call('GET', '/account/notification-preferences', 'em-viewer')).body.emailEnabled,
    ).toBe(false);
    expect(
      (await call('GET', '/account/notification-preferences', 'em-admin')).body.emailEnabled,
    ).toBe(false);
    await call('PUT', '/account/notification-preferences', 'em-sales', { emailEnabled: false });
    expect(
      (await call('GET', '/account/notification-preferences', 'em-sales')).body.emailEnabled,
    ).toBe(false);
  });

  it('rejects malformed preference bodies', async () => {
    for (const body of [{}, { emailEnabled: 'yes' }, { emailEnabled: true, userId: MISSING }]) {
      expect(
        (await call('PUT', '/account/notification-preferences', 'em-admin', body)).status,
      ).toBe(400);
    }
  });

  it('sends a test e-mail to the caller only, and limits how many', async () => {
    const ok = await call('POST', '/account/notification-email/test', 'em-manager');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ sent: true });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.to).toEqual(['em-manager@example.com']);
    for (let i = 0; i < 4; i++) {
      expect((await call('POST', '/account/notification-email/test', 'em-manager')).status).toBe(
        200,
      );
    }
    expect((await call('POST', '/account/notification-email/test', 'em-manager')).status).toBe(429);
    expect(inbox).toHaveLength(5);
  });

  it('reports a failing SMTP server without leaking details', async () => {
    rejects = [554];
    const res = await call('POST', '/account/notification-email/test', 'em-viewer');
    expect(res.status).toBe(503);
    expect(res.body.code ?? res.body.error?.code).toBe('email_send_failed');
    expect(JSON.stringify(res.body)).not.toMatch(/554|127\.0\.0\.1/);
  });

  // --- outbox ---------------------------------------------------------------------------------
  it('queues only for opted-in, active users', async () => {
    const n = await prisma.notification.create({
      data: { userId: ids['em-viewer'], type: 'system', title: 'x' },
    });
    await optIn('em-viewer', false);
    expect(
      await outbox.queueNotificationEmail(prisma, { id: n.id, userId: n.userId }, new Date()),
    ).toBe(false);
    await optIn('em-viewer', true);
    await prisma.user.update({ where: { id: ids['em-viewer'] }, data: { status: 'DISABLED' } });
    expect(
      await outbox.queueNotificationEmail(prisma, { id: n.id, userId: n.userId }, new Date()),
    ).toBe(false);
    await prisma.user.update({ where: { id: ids['em-viewer'] }, data: { status: 'ACTIVE' } });
    expect(
      await outbox.queueNotificationEmail(prisma, { id: n.id, userId: n.userId }, new Date()),
    ).toBe(true);
    await expect(
      outbox.queueNotificationEmail(prisma, { id: n.id, userId: n.userId }, new Date()),
    ).rejects.toThrow(); // UNIQUE(notification_id): one e-mail per notification
    await optIn('em-viewer', false);
  });

  it('delivers an e-mail to the user address with automatic-mail headers', async () => {
    await optIn('em-admin');
    const { id } = await queued('em-admin', 'Deal won');
    expect(await jobs.sendEmailDelivery(deps, id)).toBe('sent');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.to).toEqual(['em-admin@example.com']);
    expect(inbox[0]!.data).toMatch(/^Subject: Deal won/m);
    expect(inbox[0]!.data).toMatch(/^Auto-Submitted: auto-generated/m);
    const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'SENT', attempt: 1, nextAttemptAt: null, lastError: null });
    expect(row.sentAt).toBeInstanceOf(Date);
    // Already sent: another worker picking the job up does nothing.
    expect(await jobs.sendEmailDelivery(deps, id)).toBe('not-due');
    expect(inbox).toHaveLength(1);
    await optIn('em-admin', false);
  });

  it('retries a temporary failure on the backoff schedule, then succeeds', async () => {
    await optIn('em-manager');
    const { id } = await queued('em-manager', 'Retry me');
    rejects = [451];
    const t0 = new Date();
    expect(await jobs.sendEmailDelivery({ ...deps, now: () => t0 }, id)).toBe('retry');
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: 'PENDING', attempt: 1 });
    expect(after.nextAttemptAt.getTime()).toBe(t0.getTime() + 60_000);
    expect(after.lastError).toMatch(/451/);
    // Not due yet.
    expect(await jobs.sendEmailDelivery({ ...deps, now: () => t0 }, id)).toBe('not-due');
    const t1 = new Date(t0.getTime() + 61_000);
    expect(await jobs.sendEmailDelivery({ ...deps, now: () => t1 }, id)).toBe('sent');
    expect(inbox).toHaveLength(1);
    await optIn('em-manager', false);
  });

  it('fails at once on a permanent 5xx reply', async () => {
    await optIn('em-manager');
    const { id } = await queued('em-manager');
    rejects = [550];
    expect(await jobs.sendEmailDelivery(deps, id)).toBe('failed');
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'FAILED',
      attempt: 1,
      nextAttemptAt: null,
    });
    await optIn('em-manager', false);
  });

  it('gives up after five temporary failures', async () => {
    await optIn('em-manager');
    const { id } = await queued('em-manager');
    rejects = [451, 451, 451, 451, 451];
    let t = new Date();
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(await jobs.sendEmailDelivery({ ...deps, now: () => t }, id));
      t = new Date(t.getTime() + 7 * 60 * 60 * 1000);
    }
    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'retry', 'failed']);
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'FAILED',
      attempt: 5,
      nextAttemptAt: null,
    });
    expect(inbox).toHaveLength(0);
    await optIn('em-manager', false);
  });

  it('skips when the user opted out or was disabled after queueing', async () => {
    await optIn('em-sales');
    const a = await queued('em-sales');
    await optIn('em-sales', false);
    expect(await jobs.sendEmailDelivery(deps, a.id)).toBe('skipped');
    await optIn('em-sales');
    const b = await queued('em-sales');
    await prisma.user.update({ where: { id: ids['em-sales'] }, data: { status: 'DISABLED' } });
    expect(await jobs.sendEmailDelivery(deps, b.id)).toBe('skipped');
    await prisma.user.update({ where: { id: ids['em-sales'] }, data: { status: 'ACTIVE' } });
    expect(inbox).toHaveLength(0);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'SKIPPED',
    );
    await optIn('em-sales', false);
  });

  it('caps e-mails per user per hour and keeps the in-app notification', async () => {
    await optIn('em-viewer');
    const cap = 30;
    for (let i = 0; i < cap; i++) {
      const n = await prisma.notification.create({
        data: { userId: ids['em-viewer'], type: 'system', title: `old ${i}` },
      });
      await prisma.emailDelivery.create({
        data: {
          notificationId: n.id,
          userId: ids['em-viewer'],
          status: 'SENT',
          attempt: 1,
          sentAt: new Date(Date.now() - 10 * 60_000),
        },
      });
    }
    const { id, nid } = await queued('em-viewer', 'over the cap');
    expect(await jobs.sendEmailDelivery(deps, id)).toBe('skipped');
    expect(inbox).toHaveLength(0);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id } })).lastError).toMatch(
      /limit/,
    );
    expect(await prisma.notification.count({ where: { id: nid } })).toBe(1);
    await optIn('em-viewer', false);
  });

  it('sends exactly once when two workers race for the same delivery', async () => {
    await optIn('em-admin');
    const { id } = await queued('em-admin', 'race');
    const results = await Promise.all([
      jobs.sendEmailDelivery(deps, id),
      jobs.sendEmailDelivery(deps, id),
      jobs.sendEmailDelivery(deps, id),
    ]);
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(inbox).toHaveLength(1);
    await optIn('em-admin', false);
  });

  it('finds due rows for the sweeper and purges only finished old ones', async () => {
    await optIn('em-manager');
    const due = await queued('em-manager');
    const found = await jobs.findDueEmails(prisma, new Date());
    expect(found.map((f) => f.id)).toContain(due.id);
    const old = await queued('em-manager');
    await prisma.emailDelivery.update({
      where: { id: old.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        nextAttemptAt: null,
        createdAt: new Date(Date.now() - 40 * 86_400_000),
      },
    });
    const pendingOld = await queued('em-manager');
    await prisma.emailDelivery.update({
      where: { id: pendingOld.id },
      data: { createdAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    await jobs.purgeEmailDeliveries(prisma, new Date(), 30);
    expect(await prisma.emailDelivery.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.emailDelivery.count({ where: { id: pendingOld.id } })).toBe(1);
    expect(await prisma.emailDelivery.count({ where: { id: due.id } })).toBe(1);
    await optIn('em-manager', false);
  });

  it('queues the e-mail inside the workflow transaction', async () => {
    await optIn('em-sales');
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    const wf = await prisma.workflow.create({
      data: {
        organizationId: org.id,
        name: 'ایمیل آزمایشی',
        triggerType: 'deal.stage_changed',
        conditions: [],
        actions: [{ type: 'notify', to: { userId: ids['em-sales'] }, title: 'Workflow mail' }],
        createdById: ids['em-admin'],
      },
    });
    const { runWorkflow } = await import('../src/jobs/workflow-engine');
    const event = {
      id: '0197c0de-0000-7000-8000-0000000000a1',
      organizationId: org.id,
      type: 'deal.stage_changed',
      entityType: 'deal',
      entityId: MISSING,
      actorId: null,
      payload: {},
      causedByRunId: null,
      occurredAt: new Date(),
    };
    expect(await runWorkflow({ prisma, emailChannel: true }, wf, event, {})).toBe('succeeded');
    const n = await prisma.notification.findFirstOrThrow({
      where: { userId: ids['em-sales'], title: 'Workflow mail' },
      include: { emailDelivery: true },
    });
    expect(n.emailDelivery).toMatchObject({ status: 'PENDING', userId: ids['em-sales'] });

    // Without the channel flag (no SMTP) nothing is queued.
    const event2 = { ...event, id: '0197c0de-0000-7000-8000-0000000000a2' };
    expect(await runWorkflow({ prisma, emailChannel: false }, wf, event2, {})).toBe('succeeded');
    const second = await prisma.notification.findMany({
      where: { userId: ids['em-sales'], title: 'Workflow mail' },
      include: { emailDelivery: true },
    });
    expect(second).toHaveLength(2);
    expect(second.filter((x: any) => x.emailDelivery)).toHaveLength(1);
    await prisma.workflow.delete({ where: { id: wf.id } });
    await optIn('em-sales', false);
  });

  it('enforces the database invariants and cascades', async () => {
    const n = await prisma.notification.create({
      data: { userId: ids['em-admin'], type: 'system', title: 'inv' },
    });
    const make = (data: Record<string, unknown>) =>
      prisma.emailDelivery.create({
        data: { notificationId: n.id, userId: ids['em-admin'], ...data },
      });
    await expect(make({ status: 'WEIRD' })).rejects.toThrow();
    await expect(make({ status: 'PENDING' })).rejects.toThrow(); // PENDING needs next_attempt_at
    await expect(make({ status: 'SENT', nextAttemptAt: new Date() })).rejects.toThrow();
    await expect(make({ status: 'SENT' })).rejects.toThrow(); // SENT needs sent_at
    await expect(make({ nextAttemptAt: new Date(), attempt: 6 })).rejects.toThrow();
    await expect(make({ nextAttemptAt: new Date(), lastError: 'x'.repeat(501) })).rejects.toThrow();
    const ok = await make({ nextAttemptAt: new Date() });
    await prisma.notification.delete({ where: { id: n.id } });
    expect(await prisma.emailDelivery.count({ where: { id: ok.id } })).toBe(0);
  });
});
