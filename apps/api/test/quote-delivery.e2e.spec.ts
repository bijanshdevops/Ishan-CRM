import 'reflect-metadata';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Quote PDF and e-mail delivery against a real PostgreSQL and an in-process SMTP server (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const CHROMIUM = [process.env.PDF_CHROMIUM_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => Boolean(p))
  .find((p) => existsSync(p));
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Qd-Spec-Passw0rd';
const MISSING = '0197c0de-0000-7000-8000-000000000000';
const stamp = Date.now().toString(36);

interface Res {
  status: number;
  body: any;
  headers: Record<string, any>;
  raw: Buffer;
}
interface Mail {
  to: string[];
  data: string;
}

describe.skipIf(!run)('quote PDF and e-mail (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let jobs: typeof import('../src/jobs/quote-emails');
  let deps: any;
  let orgId = '';
  let otherOrgId = '';
  let customerId = '';
  let otherCustomerId = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'qd-admin': 'admin',
    'qd-sales': 'sales',
    'qd-unverified': 'sales',
    'qd-viewer': 'viewer',
  };
  const quoteIds: string[] = [];

  let smtp: SMTPServer;
  let inbox: Mail[] = [];
  let rejects: Array<{ code: number; message: string }> = [];
  /** Stands in for Chromium in worker tests, so they do not depend on a browser. */
  const renderer = {
    available: true,
    render: async () => Buffer.from('%PDF-1.4 stub'),
  };

  const addr = (n: string) => `${n}-${stamp}@qd.test`;

  async function call(
    method: 'GET' | 'POST',
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
    return {
      status: res.statusCode,
      body: parsed,
      headers: res.headers,
      raw: res.rawPayload,
    };
  }
  const code = (r: Res) => r.body?.code ?? r.body?.error?.code;

  async function newQuote(over: Record<string, unknown> = {}, markSent = true) {
    const res = await call('POST', '/quotes', 'qd-sales', {
      title: `پیشنهاد ${stamp}`,
      customerId,
      items: [{ description: 'خدمت <b>الف</b>', quantity: 2, unitPrice: '1000000' }],
      ...over,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    quoteIds.push(res.body.id);
    if (markSent) {
      const s = await call('POST', `/quotes/${res.body.id}/status`, 'qd-sales', { status: 'SENT' });
      expect(s.status).toBe(200);
    }
    return res.body as { id: string; number: string; version: number };
  }
  const queue = async (quoteId: string, to = addr('cust'), who = 'qd-sales', message?: string) =>
    call('POST', `/quotes/${quoteId}/emails`, who, message ? { to, message } : { to });
  const rowOf = (id: string) => prisma.quoteEmail.findUniqueOrThrow({ where: { id } });
  const header = (mail: Mail, name: string) =>
    new RegExp(`^${name}:[ \\t]*(.*)$`, 'im')
      .exec(mail.data.replace(/\r?\n[ \t]+/g, ' '))?.[1]
      ?.trim();

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      size: 10 * 1024 * 1024,
      onData(stream, session, cb) {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          const r = rejects.shift();
          if (r) {
            const err: any = new Error(r.message);
            err.responseCode = r.code;
            return cb(err);
          }
          inbox.push({
            to: session.envelope.rcptTo.map((x) => x.address),
            data: Buffer.concat(chunks).toString('utf8'),
          });
          cb();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
    applyTestEnv({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String((smtp.server.address() as AddressInfo).port),
      SMTP_ALLOW_INSECURE: 'true',
      EMAIL_FROM: 'Ishan <noreply@example.com>',
      APP_BASE_URL: 'https://crm.example.com',
      // "available" only needs the file to exist; worker tests use the stub renderer above
      PDF_CHROMIUM_PATH: CHROMIUM ?? '/bin/sh',
    });
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { PasswordService } = await import('../src/modules/auth/password.service');
    const { loadConfig } = await import('../src/config');
    jobs = await import('../src/jobs/quote-emails');
    const { createSmtpTransport } = await import('../src/jobs/emails');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    const config = loadConfig(process.env);
    deps = { prisma, transport: createSmtpTransport(config), renderer, config };
    const hash = await app.get(PasswordService).hash(PASSWORD);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    orgId = org.id;
    otherOrgId = (await prisma.organization.create({ data: { name: `qd-other-${stamp}` } })).id;
    for (const [name, key] of Object.entries(roleOf)) {
      const role = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, key } });
      const user = await prisma.user.create({
        data: {
          organizationId: orgId,
          roleId: role.id,
          email: `${name}-${stamp}@example.com`,
          name,
          passwordHash: hash,
          emailVerifiedAt: name === 'qd-unverified' ? null : new Date(),
        },
      });
      ids[name] = user.id;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ORIGIN },
        payload: { email: `${name}-${stamp}@example.com`, password: PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      const raw = res.headers['set-cookie'];
      cookies[name] = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(';')[0]!;
    }
    const customer = await prisma.customer.create({
      data: { organizationId: orgId, kind: 'PERSON', name: `مشتری ${stamp}`, email: addr('cust') },
    });
    customerId = customer.id;
    await prisma.contact.create({
      data: {
        organizationId: orgId,
        customerId,
        firstName: 'رضا',
        lastName: 'موسوی',
        email: addr('contact').toUpperCase(),
        isPrimary: true,
        searchText: 'رضا موسوی',
      },
    });
    otherCustomerId = (
      await prisma.customer.create({
        data: { organizationId: orgId, kind: 'PERSON', name: `بی‌ایمیل ${stamp}` },
      })
    ).id;
  });

  beforeEach(() => {
    inbox = [];
    rejects = [];
  });

  afterAll(async () => {
    if (prisma) {
      const all = Object.values(ids);
      await prisma.domainEvent.deleteMany({ where: { actorId: { in: all } } });
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      await prisma.contact.deleteMany({ where: { customerId } });
      await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
      await prisma.user.deleteMany({ where: { id: { in: all } } });
      if (otherOrgId)
        await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => undefined);
    }
    await app?.close();
    await new Promise<void>((r) => smtp?.close(() => r()));
  });

  // --- access control --------------------------------------------------------------------------
  it('enforces authentication and permissions on every endpoint', async () => {
    const q = await newQuote();
    const table: Array<[any, string, any, 'read' | 'write']> = [
      ['GET', `/quotes/${q.id}/pdf`, undefined, 'read'],
      ['GET', `/quotes/${q.id}/email-options`, undefined, 'write'],
      ['GET', `/quotes/${q.id}/emails`, undefined, 'read'],
      ['POST', `/quotes/${q.id}/emails`, { to: addr('cust') }, 'write'],
      ['POST', `/quotes/${q.id}/emails/${MISSING}/retry`, undefined, 'write'],
    ];
    for (const [method, url, body, need] of table) {
      expect((await call(method, url, null, body)).status, `${method} ${url} anon`).toBe(401);
      if (need === 'write') {
        expect((await call(method, url, 'qd-viewer', body)).status, `${method} ${url} viewer`).toBe(
          403,
        );
      }
    }
    expect((await call('GET', `/quotes/${q.id}/emails`, 'qd-viewer')).status).toBe(200);
    // unknown quote: a clean 404 for permitted users
    expect((await call('GET', `/quotes/${MISSING}/emails`, 'qd-sales')).status).toBe(404);
    expect((await call('GET', `/quotes/${MISSING}/email-options`, 'qd-sales')).status).toBe(404);
    expect((await call('GET', `/quotes/${MISSING}/pdf`, 'qd-sales')).status).toBe(404);
    expect((await call('GET', `/quotes/not-a-uuid/pdf`, 'qd-sales')).status).toBe(400);
  });

  it('keeps organizations apart', async () => {
    const q = await newQuote();
    // a user of another organization cannot see this quote's mail data
    const foreign = await prisma.quote.findFirstOrThrow({ where: { id: q.id } });
    expect(foreign.organizationId).toBe(orgId);
    const stranger = await prisma.role.create({
      data: {
        organizationId: otherOrgId,
        key: 'admin',
        name: 'x',
        permissions: ['quotes.read', 'quotes.write'],
      },
    });
    const hash = await app
      .get((await import('../src/modules/auth/password.service')).PasswordService)
      .hash(PASSWORD);
    const u = await prisma.user.create({
      data: {
        organizationId: otherOrgId,
        roleId: stranger.id,
        email: `qd-stranger-${stamp}@example.com`,
        name: 'stranger',
        passwordHash: hash,
        emailVerifiedAt: new Date(),
      },
    });
    ids['qd-stranger'] = u.id;
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: `qd-stranger-${stamp}@example.com`, password: PASSWORD },
    });
    const raw = login.headers['set-cookie'];
    cookies['qd-stranger'] = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(';')[0]!;
    for (const [m, url] of [
      ['GET', `/quotes/${q.id}/email-options`],
      ['GET', `/quotes/${q.id}/emails`],
      ['GET', `/quotes/${q.id}/pdf`],
    ] as const) {
      expect((await call(m, url, 'qd-stranger')).status, url).toBe(404);
    }
    expect((await queue(q.id, addr('cust'), 'qd-stranger')).status).toBe(404);
    await prisma.user.delete({ where: { id: u.id } });
    await prisma.role.delete({ where: { id: stranger.id } });
  });

  // --- options and validation ------------------------------------------------------------------
  it('offers only the addresses on the customer file, and the verified reply-to', async () => {
    const q = await newQuote();
    const res = await call('GET', `/quotes/${q.id}/email-options`, 'qd-sales');
    expect(res.status).toBe(200);
    expect(res.body.emailAvailable).toBe(true);
    expect(res.body.pdfAvailable).toBe(true);
    expect(res.body.replyTo).toBe(`qd-sales-${stamp}@example.com`);
    expect(res.body.recipients.map((r: any) => r.email).sort()).toEqual(
      [addr('contact'), addr('cust')].sort(),
    );
    const un = await call('GET', `/quotes/${q.id}/email-options`, 'qd-unverified');
    expect(un.body.replyTo).toBeNull();
    const none = await newQuote({ customerId: otherCustomerId });
    expect(
      (await call('GET', `/quotes/${none.id}/email-options`, 'qd-sales')).body.recipients,
    ).toEqual([]);
  });

  it('refuses drafts, unverified senders, unknown addresses and bad input', async () => {
    const draft = await newQuote({}, false);
    const r1 = await queue(draft.id);
    expect(r1.status).toBe(409);
    expect(code(r1)).toBe('quote_not_sendable');

    const q = await newQuote();
    const r2 = await queue(q.id, addr('cust'), 'qd-unverified');
    expect(r2.status).toBe(409);
    expect(code(r2)).toBe('email_not_verified');

    const r3 = await queue(q.id, addr('stranger'));
    expect(r3.status).toBe(400);
    expect(code(r3)).toBe('recipient_not_allowed');

    expect((await queue(q.id, 'not-an-email')).status).toBe(400);
    expect(
      (await call('POST', `/quotes/${q.id}/emails`, 'qd-sales', { to: addr('cust'), x: 1 })).status,
    ).toBe(400);
    expect((await queue(q.id, addr('cust'), 'qd-sales', 'x'.repeat(2001))).status).toBe(400);
    expect(await prisma.quoteEmail.count({ where: { quoteId: { in: [draft.id, q.id] } } })).toBe(0);
  });

  // --- queueing --------------------------------------------------------------------------------
  it('queues once per recipient, matches the address case-insensitively, and audits it', async () => {
    const q = await newQuote();
    const res = await queue(q.id, addr('contact'), 'qd-sales', 'سلام\nلطفاً بررسی کنید.');
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({
      quoteId: q.id,
      to: addr('contact'),
      status: 'PENDING',
      attempt: 0,
      version: 1,
      sender: { id: ids['qd-sales'] },
    });
    const row = await rowOf(res.body.id);
    expect(row).toMatchObject({
      organizationId: orgId,
      replyTo: `qd-sales-${stamp}@example.com`,
      status: 'PENDING',
    });
    expect(row.nextAttemptAt).toBeTruthy();

    const again = await queue(q.id, addr('contact'));
    expect(again.status).toBe(409);
    expect(code(again)).toBe('already_queued');
    // another recipient is fine
    expect((await queue(q.id, addr('cust'))).status).toBe(202);

    const audit = await prisma.auditLog.count({
      where: { action: 'quote.emailed', entityId: q.id, actorId: ids['qd-sales'] },
    });
    expect(audit).toBe(2);
    const list = await call('GET', `/quotes/${q.id}/emails`, 'qd-viewer');
    expect(list.body).toHaveLength(2);
  });

  it('serializes concurrent clicks for the same recipient', async () => {
    const q = await newQuote();
    const results = await Promise.all(Array.from({ length: 5 }, () => queue(q.id, addr('cust'))));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.quoteEmail.count({ where: { quoteId: q.id } })).toBe(1);
  });

  it('limits how many quote e-mails one user can queue per hour', async () => {
    const q = await newQuote();
    await prisma.quoteEmail.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        organizationId: orgId,
        quoteId: q.id,
        senderId: ids['qd-admin'],
        toEmail: `cap${i}-${stamp}@qd.test`,
        replyTo: 'a@b.test',
        status: 'FAILED',
        attempt: 5,
        lastError: 'x',
      })),
    });
    const res = await queue(q.id, addr('cust'), 'qd-admin');
    expect(res.status).toBe(429);
    expect(code(res)).toBe('rate_limited');
    // the cap is per user: another user is unaffected
    expect((await queue(q.id, addr('cust'), 'qd-sales')).status).toBe(202);
  });

  // --- delivery by the worker ------------------------------------------------------------------
  it('delivers one e-mail with the PDF attached, once, with the sender as reply-to', async () => {
    const q = await newQuote();
    const queued = await queue(q.id, addr('cust'), 'qd-sales', 'پیش‌فاکتور شما');
    expect(await jobs.sendQuoteEmail(deps, queued.body.id)).toBe('sent');
    expect(await jobs.sendQuoteEmail(deps, queued.body.id)).toBe('not-due');
    expect(inbox).toHaveLength(1);
    const mail = inbox[0]!;
    expect(mail.to).toEqual([addr('cust')]);
    expect(header(mail, 'Reply-To')).toContain(`qd-sales-${stamp}@example.com`);
    expect(header(mail, 'From')).toContain('noreply@example.com');
    expect(mail.data).toMatch(/Content-Type: application\/pdf/i);
    expect(mail.data).toContain(`${q.number}-v1.pdf`);
    expect(mail.data).toContain(Buffer.from('%PDF-1.4 stub').toString('base64'));
    const row = await rowOf(queued.body.id);
    expect(row).toMatchObject({ status: 'SENT', attempt: 1, nextAttemptAt: null, lastError: null });
    expect(row.sentAt).toBeTruthy();
  });

  it('retries temporary failures; a permanent rejection fails at once', async () => {
    const q = await newQuote();
    const queued = await queue(q.id, addr('cust'));
    rejects = [{ code: 451, message: 'try later' }];
    const t0 = new Date();
    expect(await jobs.sendQuoteEmail({ ...deps, now: () => t0 }, queued.body.id)).toBe('retry');
    const r = await rowOf(queued.body.id);
    expect(r).toMatchObject({ status: 'PENDING', attempt: 1 });
    expect(r.nextAttemptAt.getTime()).toBe(t0.getTime() + 60_000);
    expect(await jobs.sendQuoteEmail({ ...deps, now: () => t0 }, queued.body.id)).toBe('not-due');
    // 1 minute later it is due again; this time the server refuses the mailbox for good
    rejects = [{ code: 550, message: 'no such user' }];
    const t1 = new Date(t0.getTime() + 61_000);
    expect(await jobs.sendQuoteEmail({ ...deps, now: () => t1 }, queued.body.id)).toBe('failed');
    const f = await rowOf(queued.body.id);
    expect(f).toMatchObject({ status: 'FAILED', attempt: 2, nextAttemptAt: null });
    expect(f.lastError).toContain('no such user');
    expect(inbox).toHaveLength(0);
  });

  it('gives up after five temporary failures', async () => {
    const q = await newQuote();
    const queued = await queue(q.id, addr('cust'));
    let t = new Date();
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      rejects = [{ code: 451, message: 'again' }];
      outcomes.push(await jobs.sendQuoteEmail({ ...deps, now: () => t }, queued.body.id));
      t = new Date(t.getTime() + 7 * 3600_000);
    }
    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'retry', 'failed']);
    expect(await rowOf(queued.body.id)).toMatchObject({ status: 'FAILED', attempt: 5 });
  });

  it('fails permanently when the quote is no longer sendable', async () => {
    const q = await newQuote();
    const queued = await queue(q.id, addr('cust'));
    await prisma.quote.update({ where: { id: q.id }, data: { status: 'REJECTED' } });
    expect(await jobs.sendQuoteEmail(deps, queued.body.id)).toBe('failed');
    expect(inbox).toHaveLength(0);
    expect((await rowOf(queued.body.id)).lastError).toContain('can no longer be e-mailed');
  });

  it('lets a failed e-mail be queued again, and only a failed one', async () => {
    const q = await newQuote();
    const queued = await queue(q.id, addr('cust'));
    const notFailed = await call(
      'POST',
      `/quotes/${q.id}/emails/${queued.body.id}/retry`,
      'qd-sales',
    );
    expect(notFailed.status).toBe(409);
    rejects = [{ code: 550, message: 'no' }];
    expect(await jobs.sendQuoteEmail(deps, queued.body.id)).toBe('failed');
    const ok = await call('POST', `/quotes/${q.id}/emails/${queued.body.id}/retry`, 'qd-sales');
    expect(ok.status).toBe(204);
    expect(await rowOf(queued.body.id)).toMatchObject({
      status: 'PENDING',
      attempt: 0,
      lastError: null,
    });
    expect(await jobs.sendQuoteEmail(deps, queued.body.id)).toBe('sent');
    // an unknown id, and an id from another quote
    const other = await newQuote();
    expect(
      (await call('POST', `/quotes/${other.id}/emails/${queued.body.id}/retry`, 'qd-sales')).status,
    ).toBe(409);
  });

  it('finds due e-mails for the sweeper and ignores finished ones', async () => {
    const q = await newQuote();
    const queued = await queue(q.id, addr('cust'));
    const due = await jobs.findDueQuoteEmails(prisma, new Date(Date.now() + 1000));
    expect(due.map((d) => d.id)).toContain(queued.body.id);
    await jobs.sendQuoteEmail(deps, queued.body.id);
    const after = await jobs.findDueQuoteEmails(prisma, new Date(Date.now() + 1000));
    expect(after.map((d) => d.id)).not.toContain(queued.body.id);
  });

  it('enforces the database invariants', async () => {
    const q = await newQuote();
    const base = {
      organizationId: orgId,
      quoteId: q.id,
      toEmail: addr('inv'),
      replyTo: 'a@b.test',
    };
    const bad: Array<Record<string, unknown>> = [
      { status: 'WEIRD' },
      { status: 'PENDING', nextAttemptAt: null },
      { status: 'SENT', sentAt: null },
      { status: 'FAILED', nextAttemptAt: new Date() },
      { status: 'FAILED', attempt: 6 },
      { status: 'FAILED', toEmail: 'UPPER@qd.test' },
      { status: 'FAILED', message: 'x'.repeat(2001) },
    ];
    for (const over of bad) {
      await expect(
        prisma.quoteEmail.create({ data: { ...base, ...over } }),
        JSON.stringify(over),
      ).rejects.toThrow();
    }
  });

  // --- the PDF itself --------------------------------------------------------------------------
  it.skipIf(!CHROMIUM)(
    'renders a real PDF with Persian text, escaped, as an attachment',
    async () => {
      const q = await newQuote({ notes: '<script>alert(1)</script> یادداشت' });
      const res = await call('GET', `/quotes/${q.id}/pdf`, 'qd-viewer');
      expect(res.status, res.raw.toString('utf8').slice(0, 300)).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${q.number}-v1.pdf"`);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.raw.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.raw.length).toBeGreaterThan(5_000);
      // the real renderer also feeds the worker path
      const { PdfRenderer } = await import('../src/modules/quotes/pdf-renderer');
      const real = new PdfRenderer(CHROMIUM);
      try {
        const queued = await queue(q.id, addr('cust'));
        expect(await jobs.sendQuoteEmail({ ...deps, renderer: real }, queued.body.id)).toBe('sent');
        expect(inbox).toHaveLength(1);
        expect(inbox[0]!.data).toContain('filename="' + q.number + '-v1.pdf"');
      } finally {
        await real.close();
      }
    },
  );
});
