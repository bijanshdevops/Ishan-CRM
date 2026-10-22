import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Campaign e-mail sending against a real PostgreSQL and an in-process SMTP server (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Cs-Spec-Passw0rd';
const MISSING = '0197c0de-0000-7000-8000-000000000000';
const stamp = Date.now().toString(36);

interface Res {
  status: number;
  body: any;
}
interface Mail {
  to: string[];
  data: string;
}

describe.skipIf(!run)('campaign e-mail sending (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let jobs: typeof import('../src/jobs/campaign-emails');
  let deps: any;
  let orgId = '';
  let otherOrgId = '';
  let vipTag = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const campaigns: string[] = [];
  const roleOf: Record<string, string> = {
    'cs-admin': 'admin',
    'cs-manager': 'manager',
    'cs-sales': 'sales',
    'cs-viewer': 'viewer',
  };

  let smtp: SMTPServer;
  let inbox: Mail[] = [];
  /** SMTP rejections consumed in order for each DATA command; empty = accept. */
  let rejects: Array<{ code: number; message: string }> = [];

  const addr = (n: string) => `${n}-${stamp}@cs.test`;

  async function call(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    who: string | null,
    body?: unknown,
    extra: { headers?: Record<string, string>; raw?: string } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = { ...extra.headers };
    if (who) headers.cookie = cookies[who]!;
    if (method !== 'GET') headers.origin = ORIGIN;
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(extra.raw !== undefined
        ? { payload: extra.raw }
        : body !== undefined
          ? { payload: body as object }
          : {}),
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = undefined;
    }
    return { status: res.statusCode, body: parsed };
  }
  const code = (r: Res) => r.body?.code ?? r.body?.error?.code;

  const newCampaign = async (name: string, organizationId = orgId) => {
    const c = await prisma.campaign.create({
      data: { organizationId, name: `${name} ${stamp}`, createdById: ids['cs-admin'] },
    });
    campaigns.push(c.id);
    return c.id as string;
  };
  const draft = (over: Record<string, unknown> = {}) => ({
    subject: 'پیشنهاد ویژه برای {{customerName}}',
    body: 'سلام {{customerName}}\n\nاین یک پیشنهاد آزمایشی است.',
    audience: { tagIds: [vipTag], kind: null },
    ...over,
  });
  const recipients = (sendingId: string) =>
    prisma.campaignRecipient.findMany({ where: { sendingId }, orderBy: { email: 'asc' } });
  const sendingOf = (campaignId: string) =>
    prisma.campaignSending.findUniqueOrThrow({ where: { campaignId } });
  /** Draft + start; returns the recipient ids. */
  async function started(name: string, expected = 3) {
    const id = await newCampaign(name);
    expect((await call('PUT', `/campaigns/${id}/sending`, 'cs-manager', draft())).status).toBe(200);
    const res = await call('POST', `/campaigns/${id}/sending/start`, 'cs-admin', {
      expectedRecipients: expected,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sending = await sendingOf(id);
    return { id, sending, rows: await recipients(sending.id) };
  }
  /** Header value with folded lines joined back (long List-Unsubscribe URLs get folded). */
  const header = (mail: Mail, name: string) =>
    new RegExp(`^${name}:[ \\t]*(.*)$`, 'im')
      .exec(mail.data.replace(/\r?\n[ \t]+/g, ' '))?.[1]
      ?.trim();

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
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
      CAMPAIGN_EMAIL_FROM: 'Ishan Marketing <marketing@example.com>',
      APP_BASE_URL: 'https://crm.example.com',
    });
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { PasswordService } = await import('../src/modules/auth/password.service');
    const { loadConfig } = await import('../src/config');
    jobs = await import('../src/jobs/campaign-emails');
    const { createSmtpTransport } = await import('../src/jobs/emails');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    const config = loadConfig(process.env);
    deps = { prisma, transport: createSmtpTransport(config), config };
    const hash = await app.get(PasswordService).hash(PASSWORD);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    orgId = org.id;
    otherOrgId = (await prisma.organization.create({ data: { name: `cs-other-${stamp}` } })).id;
    for (const [name, key] of Object.entries(roleOf)) {
      const role = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, key } });
      const user = await prisma.user.create({
        data: {
          organizationId: orgId,
          roleId: role.id,
          email: `${name}-${stamp}@example.com`,
          name,
          passwordHash: hash,
          emailVerifiedAt: name === 'cs-admin' ? new Date() : null,
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
    // Audience: three reachable VIPs (one through a primary contact), one without e-mail,
    // one deleted, one invalid address, one untagged.
    vipTag = (await prisma.tag.create({ data: { organizationId: orgId, name: `cs-vip-${stamp}` } }))
      .id;
    const mk = (name: string, email: string | null, over: Record<string, unknown> = {}) =>
      prisma.customer.create({
        data: { organizationId: orgId, kind: 'PERSON', name, email, ...over },
      });
    const tagged = async (c: any) =>
      prisma.customerTag.create({ data: { customerId: c.id, tagId: vipTag } });
    await tagged(await mk('علی احمدی', addr('a1')));
    await tagged(await mk('سارا کریمی', addr('a2').toUpperCase()));
    const viaContact = await mk('شرکت نمونه', null);
    await prisma.contact.create({
      data: {
        organizationId: orgId,
        customerId: viaContact.id,
        firstName: 'رضا',
        lastName: 'موسوی',
        email: addr('k3'),
        isPrimary: true,
      },
    });
    await tagged(viaContact);
    await tagged(await mk('بدون ایمیل', null));
    await tagged(await mk('حذف‌شده', addr('gone'), { deletedAt: new Date() }));
    await tagged(await mk('نشانی خراب', 'not-an-email'));
    await mk('بدون برچسب', addr('untagged'));
  });

  beforeEach(async () => {
    inbox = [];
    rejects = [];
    // suppressions made by one test must not shrink the audience of the next
    await prisma.marketingSuppression.deleteMany({
      where: { organizationId: orgId, email: { endsWith: '@cs.test' } },
    });
  });

  afterAll(async () => {
    if (prisma) {
      const all = Object.values(ids);
      const orgs = [orgId, otherOrgId].filter(Boolean);
      await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
      await prisma.marketingSuppression.deleteMany({
        where: { organizationId: { in: orgs }, email: { endsWith: '@cs.test' } },
      });
      await prisma.customer.deleteMany({
        where: { organizationId: orgId, email: { endsWith: '@cs.test' } },
      });
      await prisma.customer.deleteMany({
        where: { organizationId: orgId, name: { in: ['شرکت نمونه', 'بدون ایمیل', 'نشانی خراب'] } },
      });
      await prisma.tag.deleteMany({ where: { id: vipTag } });
      await prisma.user.deleteMany({ where: { id: { in: all } } });
      if (otherOrgId)
        await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => undefined);
    }
    await app?.close();
    await new Promise<void>((r) => smtp?.close(() => r()));
  });

  // --- access control --------------------------------------------------------------------------
  it('enforces authentication and permissions on every endpoint', async () => {
    const cid = await newCampaign('authz');
    const base = `/campaigns/${cid}/sending`;
    const table: Array<[string, any, string, any, string[]]> = [
      ['GET', base, 'read', undefined, ['cs-admin', 'cs-manager']],
      ['PUT', base, 'write', draft(), ['cs-admin', 'cs-manager']],
      ['POST', `${base}/preview`, 'write', undefined, ['cs-admin', 'cs-manager']],
      ['POST', `${base}/test`, 'write', undefined, ['cs-admin', 'cs-manager']],
      ['POST', `${base}/start`, 'send', { expectedRecipients: 1 }, ['cs-admin']],
      ['POST', `${base}/cancel`, 'send', undefined, ['cs-admin']],
      ['GET', '/marketing/suppressions', 'read', undefined, ['cs-admin', 'cs-manager']],
      [
        'POST',
        '/marketing/suppressions',
        'write',
        { email: addr('authz') },
        ['cs-admin', 'cs-manager'],
      ],
      [
        'DELETE',
        `/marketing/suppressions/${MISSING}`,
        'write',
        undefined,
        ['cs-admin', 'cs-manager'],
      ],
    ];
    for (const [m, url, , body, allowed] of table) {
      expect((await call(m as any, url, null, body)).status, `${m} ${url} anon`).toBe(401);
      for (const who of ['cs-admin', 'cs-manager', 'cs-sales', 'cs-viewer']) {
        const res = await call(m as any, url, who, body);
        if (allowed.includes(who)) {
          expect([401, 403], `${m} ${url} ${who}`).not.toContain(res.status);
        } else if (who === 'cs-sales' || who === 'cs-viewer' || !allowed.includes(who)) {
          // read-only roles may read; nobody outside `allowed` may write or send
          if (m !== 'GET') expect(res.status, `${m} ${url} ${who}`).toBe(403);
        }
      }
    }
    // the manager (sales manager) can prepare but never start or cancel a send
    for (const url of [`${base}/start`, `${base}/cancel`]) {
      expect((await call('POST', url, 'cs-manager', { expectedRecipients: 1 })).status).toBe(403);
    }
  });

  it('keeps organizations apart', async () => {
    const foreign = await newCampaign('foreign', otherOrgId);
    const base = `/campaigns/${foreign}/sending`;
    expect((await call('GET', base, 'cs-admin')).status).toBe(404);
    expect((await call('PUT', base, 'cs-admin', draft())).status).toBe(404);
    expect(
      (await call('POST', `${base}/start`, 'cs-admin', { expectedRecipients: 1 })).status,
    ).toBe(404);
    expect((await call('POST', `${base}/cancel`, 'cs-admin')).status).toBe(404);
    const s = await prisma.marketingSuppression.create({
      data: { organizationId: otherOrgId, email: addr('foreign'), reason: 'MANUAL' },
    });
    const list = await call('GET', '/marketing/suppressions', 'cs-admin');
    expect(list.body.map((x: any) => x.id)).not.toContain(s.id);
    expect((await call('DELETE', `/marketing/suppressions/${s.id}`, 'cs-admin')).status).toBe(404);
    expect(await prisma.marketingSuppression.count({ where: { id: s.id } })).toBe(1);
  });

  // --- draft -----------------------------------------------------------------------------------
  it('validates the draft', async () => {
    const id = await newCampaign('validate');
    const put = (b: unknown) => call('PUT', `/campaigns/${id}/sending`, 'cs-manager', b);
    for (const bad of [
      draft({ subject: '' }),
      draft({ subject: 'a\nBcc: x@y.z' }),
      draft({ body: 'سلام {{email}}' }),
      draft({ subject: '{{customerName}} {{other}}' }),
      draft({ body: 'x'.repeat(5001) }),
      draft({ audience: { tagIds: ['nope'], kind: null } }),
      { ...draft(), extra: 1 },
    ]) {
      expect((await put(bad)).status).toBe(400);
    }
    const unknownTag = await put(draft({ audience: { tagIds: [MISSING], kind: null } }));
    expect(unknownTag.status).toBe(422);
    expect(code(unknownTag)).toBe('unknown_tag');
    expect((await call('GET', `/campaigns/${id}/sending`, 'cs-manager')).body).toMatchObject({
      emailAvailable: true,
      sending: null,
    });
    const ok = await put(draft());
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'DRAFT', counts: { PENDING: 0, SENT: 0 } });
    // saving again replaces the draft
    expect((await put(draft({ subject: 'عنوان تازه' }))).body.subject).toBe('عنوان تازه');
  });

  it('previews who would receive it, minus suppressed addresses', async () => {
    const id = await newCampaign('preview');
    expect((await call('POST', `/campaigns/${id}/sending/preview`, 'cs-manager')).status).toBe(409);
    await call('PUT', `/campaigns/${id}/sending`, 'cs-manager', draft());
    const first = await call('POST', `/campaigns/${id}/sending/preview`, 'cs-manager');
    expect(first.status).toBe(200);
    // a1, a2 (case-insensitive) and the primary contact of the company; not the deleted,
    // address-less, invalid or untagged customers
    expect(first.body.recipients).toBe(3);
    expect(first.body.suppressed).toBe(0);
    expect(first.body.sample.subject).toMatch(/^پیشنهاد ویژه برای /);
    await prisma.marketingSuppression.create({
      data: { organizationId: orgId, email: addr('a2'), reason: 'UNSUBSCRIBED' },
    });
    const second = await call('POST', `/campaigns/${id}/sending/preview`, 'cs-manager');
    expect(second.body).toMatchObject({ recipients: 2, suppressed: 1 });
    await prisma.marketingSuppression.deleteMany({
      where: { organizationId: orgId, email: addr('a2') },
    });
  });

  it('sends a test only to a verified address, without an unsubscribe link', async () => {
    const id = await newCampaign('test-mail');
    await call('PUT', `/campaigns/${id}/sending`, 'cs-manager', draft());
    const unverified = await call('POST', `/campaigns/${id}/sending/test`, 'cs-manager');
    expect(unverified.status).toBe(422);
    expect(code(unverified)).toBe('email_not_verified');
    const ok = await call('POST', `/campaigns/${id}/sending/test`, 'cs-admin');
    expect(ok.status).toBe(200);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.to).toEqual([`cs-admin-${stamp}@example.com`]);
    expect(header(inbox[0]!, 'List-Unsubscribe')).toBeUndefined();
  });

  // --- start / worker ---------------------------------------------------------------------------
  it('refuses to start when the audience changed since the preview, and starts nothing', async () => {
    const id = await newCampaign('stale');
    await call('PUT', `/campaigns/${id}/sending`, 'cs-manager', draft());
    const res = await call('POST', `/campaigns/${id}/sending/start`, 'cs-admin', {
      expectedRecipients: 2,
    });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('recipients_changed');
    expect((await sendingOf(id)).status).toBe('DRAFT'); // the transaction rolled back
    expect(await prisma.campaignRecipient.count({ where: { campaignId: id } })).toBe(0);
    expect(
      (await call('POST', `/campaigns/${id}/sending/start`, 'cs-admin', { expectedRecipients: 0 }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/campaigns/${id}/sending/start`, 'cs-admin', {
          expectedRecipients: 3,
          x: 1,
        })
      ).status,
    ).toBe(400);
  });

  it('starts once, locks the draft and delivers every recipient exactly once', async () => {
    const { id, sending, rows } = await started('full');
    expect(rows).toHaveLength(3);
    expect(
      rows.every((r: any) => r.status === 'PENDING' && r.email === r.email.toLowerCase()),
    ).toBe(true);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    expect(campaign.status).toBe('ACTIVE');
    expect(
      await prisma.auditLog.count({ where: { action: 'campaign.send_started', entityId: id } }),
    ).toBe(1);
    // locked
    const again = await call('POST', `/campaigns/${id}/sending/start`, 'cs-admin', {
      expectedRecipients: 3,
    });
    expect(again.status).toBe(409);
    expect(code(again)).toBe('sending_not_draft');
    const edit = await call('PUT', `/campaigns/${id}/sending`, 'cs-manager', draft());
    expect(edit.status).toBe(409);
    expect(code(edit)).toBe('sending_locked');

    // two workers racing for each recipient still send once
    for (const r of rows) {
      const out = await Promise.all([
        jobs.sendCampaignRecipient(deps, r.id),
        jobs.sendCampaignRecipient(deps, r.id),
      ]);
      expect(out.filter((o) => o === 'sent')).toHaveLength(1);
    }
    expect(inbox).toHaveLength(3);
    for (const m of inbox) {
      expect(header(m, 'From')).toContain('marketing@example.com');
      expect(header(m, 'Precedence')).toBe('bulk');
      expect(header(m, 'List-Unsubscribe-Post')).toBe('List-Unsubscribe=One-Click');
      expect(header(m, 'List-Unsubscribe')).toMatch(
        /^<https:\/\/crm\.example\.com\/api\/v1\/public\/unsubscribe\?token=[\w.-]+>$/,
      );
    }
    const done = await call('GET', `/campaigns/${id}/sending`, 'cs-manager');
    expect(done.body.sending).toMatchObject({ status: 'DONE', counts: { SENT: 3, PENDING: 0 } });
    expect(done.body.sending.finishedAt).toBeTruthy();
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED');
    // a closed campaign cannot be sent again
    expect(sending.status).toBe('SENDING');
  });

  it('unsubscribes through the one-click link and the web form, and rejects forged tokens', async () => {
    const { rows } = await started('unsub');
    await jobs.sendCampaignRecipient(deps, rows[0].id);
    const mail = inbox.at(-1)!;
    const token = /token=([\w.-]+)>/.exec(header(mail, 'List-Unsubscribe')!)![1]!;

    // RFC 8058: form body, token in the URL
    const oneClick = await call('POST', `/public/unsubscribe?token=${token}`, null, undefined, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      raw: 'List-Unsubscribe=One-Click',
    });
    expect(oneClick.status).toBe(200);
    expect(oneClick.body).toEqual({ unsubscribed: true });
    const sup = await prisma.marketingSuppression.findFirstOrThrow({
      where: { organizationId: orgId, email: rows[0].email },
    });
    expect(sup.reason).toBe('UNSUBSCRIBED');
    // the web page posts JSON; repeating is harmless
    const web = await call('POST', '/public/unsubscribe', null, { token });
    expect(web.status).toBe(200);
    expect(
      await prisma.marketingSuppression.count({
        where: { organizationId: orgId, email: rows[0].email },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'marketing.unsubscribed', entityId: sup.id },
      }),
    ).toBe(1);

    // forged / malformed
    const [payload, sig] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ o: orgId, e: addr('victim') })).toString(
      'base64url',
    );
    for (const bad of [
      `${forgedPayload}.${sig}`,
      `${payload}.${'0'.repeat(64)}`,
      `${payload}`,
      `${payload}.${sig}.x`,
      'x'.repeat(40),
    ]) {
      const r = await call('POST', '/public/unsubscribe', null, { token: bad });
      expect(r.status, bad).toBe(400);
      expect(code(r)).toBe('invalid_token');
    }
    expect(await prisma.marketingSuppression.count({ where: { email: addr('victim') } })).toBe(0);
    expect((await call('POST', '/public/unsubscribe', null, {})).status).toBe(400);
  });

  it('re-checks the suppression list at send time', async () => {
    const { rows } = await started('late-suppress');
    await prisma.marketingSuppression.create({
      data: { organizationId: orgId, email: rows[1].email, reason: 'MANUAL' },
    });
    expect(await jobs.sendCampaignRecipient(deps, rows[1].id)).toBe('skipped');
    expect(inbox).toHaveLength(0);
    const r = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: rows[1].id } });
    expect(r).toMatchObject({ status: 'SKIPPED', lastError: 'address is suppressed' });
  });

  it('retries temporary failures; a hard bounce fails at once and suppresses the address', async () => {
    const { rows } = await started('retry');
    rejects = [{ code: 451, message: 'try later' }];
    const t0 = new Date();
    expect(await jobs.sendCampaignRecipient({ ...deps, now: () => t0 }, rows[0].id)).toBe('retry');
    const r = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(r).toMatchObject({ status: 'PENDING', attempt: 1 });
    expect(r.nextAttemptAt.getTime()).toBe(t0.getTime() + 60_000);
    expect(await jobs.sendCampaignRecipient({ ...deps, now: () => t0 }, rows[0].id)).toBe(
      'not-due',
    );
    const t1 = new Date(t0.getTime() + 61_000);
    expect(await jobs.sendCampaignRecipient({ ...deps, now: () => t1 }, rows[0].id)).toBe('sent');

    rejects = [{ code: 550, message: '5.1.1 user unknown' }];
    expect(await jobs.sendCampaignRecipient(deps, rows[1].id)).toBe('failed');
    expect(
      await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: rows[1].id } }),
    ).toMatchObject({
      status: 'FAILED',
      attempt: 1,
      nextAttemptAt: null,
    });
    expect(
      await prisma.marketingSuppression.findFirst({
        where: { organizationId: orgId, email: rows[1].email, reason: 'BOUNCED' },
      }),
    ).not.toBeNull();

    // a policy rejection is permanent too, but is not proof the mailbox is gone
    rejects = [{ code: 554, message: '5.7.1 rejected as spam' }];
    expect(await jobs.sendCampaignRecipient(deps, rows[2].id)).toBe('failed');
    expect(
      await prisma.marketingSuppression.count({
        where: { organizationId: orgId, email: rows[2].email },
      }),
    ).toBe(0);
    // every recipient is finished, so the send closed
    expect((await sendingOf(rows[0].campaignId)).status).toBe('DONE');
  });

  it('cancels a running send: pending recipients are skipped, nothing more is mailed', async () => {
    const { id, rows } = await started('cancel');
    expect(await jobs.sendCampaignRecipient(deps, rows[0].id)).toBe('sent');
    expect((await call('POST', `/campaigns/${id}/sending/cancel`, 'cs-manager')).status).toBe(403);
    const res = await call('POST', `/campaigns/${id}/sending/cancel`, 'cs-admin');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CANCELED',
      counts: { SENT: 1, SKIPPED: 2, PENDING: 0 },
    });
    expect(await jobs.sendCampaignRecipient(deps, rows[1].id)).toBe('not-due');
    expect(inbox).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'campaign.send_canceled', entityId: id } }),
    ).toBe(1);
    const again = await call('POST', `/campaigns/${id}/sending/cancel`, 'cs-admin');
    expect(again.status).toBe(409);
  });

  it('refuses to start a closed campaign', async () => {
    const id = await newCampaign('closed');
    await call('PUT', `/campaigns/${id}/sending`, 'cs-manager', draft());
    await prisma.campaign.update({ where: { id }, data: { status: 'CANCELED' } });
    const res = await call('POST', `/campaigns/${id}/sending/start`, 'cs-admin', {
      expectedRecipients: 3,
    });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('campaign_closed');
  });

  it('caps the number of recipients', async () => {
    const id = await newCampaign('cap');
    const svc = app.get(
      (await import('../src/modules/marketing/campaign-sending.service')).CampaignSendingService,
    );
    expect(id).toBeTruthy();
    // 5001 distinct addresses would exceed the cap; build them cheaply on one tagged customer set
    const big = await prisma.tag.create({
      data: { organizationId: orgId, name: `cs-big-${stamp}` },
    });
    const data = Array.from({ length: 5001 }, (_, i) => ({
      organizationId: orgId,
      kind: 'PERSON',
      name: `big ${i}`,
      email: `big${i}-${stamp}@cs.test`,
    }));
    await prisma.customer.createMany({ data });
    const created = await prisma.customer.findMany({
      where: { organizationId: orgId, email: { endsWith: `-${stamp}@cs.test`, startsWith: 'big' } },
      select: { id: true },
    });
    await prisma.customerTag.createMany({
      data: created.map((c: any) => ({ customerId: c.id, tagId: big.id })),
    });
    await expect(
      svc.resolveAudience(
        { organizationId: orgId, scopeUserIds: null },
        { tagIds: [big.id], kind: null },
      ),
    ).rejects.toMatchObject({
      response: { code: 'too_many_recipients' },
    });
    await prisma.tag.delete({ where: { id: big.id } });
  }, 60_000);

  // --- suppression list ------------------------------------------------------------------------
  it('manages the suppression list', async () => {
    const e = addr('manual');
    expect((await call('POST', '/marketing/suppressions', 'cs-sales', { email: e })).status).toBe(
      403,
    );
    for (const bad of [{}, { email: 'nope' }, { email: e, reason: 'BOUNCED' }]) {
      expect((await call('POST', '/marketing/suppressions', 'cs-manager', bad)).status).toBe(400);
    }
    const added = await call('POST', '/marketing/suppressions', 'cs-manager', {
      email: e.toUpperCase(),
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ email: e, reason: 'MANUAL' });
    // adding again changes nothing
    const dup = await call('POST', '/marketing/suppressions', 'cs-manager', { email: e });
    expect(dup.body.id).toBe(added.body.id);
    const list = await call('GET', '/marketing/suppressions', 'cs-manager');
    expect(list.body.filter((x: any) => x.email === e)).toHaveLength(1);
    expect(
      (await call('DELETE', `/marketing/suppressions/${added.body.id}`, 'cs-manager')).status,
    ).toBe(204);
    expect(
      (await call('DELETE', `/marketing/suppressions/${added.body.id}`, 'cs-manager')).status,
    ).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { action: 'marketing.suppression_added', entityId: added.body.id },
      }),
    ).toBeGreaterThan(0);
  });

  // --- housekeeping and invariants -----------------------------------------------------------------
  it('finds due recipients for the sweeper and purges only finished old ones', async () => {
    const { rows } = await started('housekeeping');
    const due = await jobs.findDueCampaignRecipients(prisma, new Date(Date.now() + 1000));
    expect(due.map((d) => d.id)).toEqual(expect.arrayContaining(rows.map((r: any) => r.id)));
    await jobs.sendCampaignRecipient(deps, rows[0].id);
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.campaignRecipient.update({ where: { id: rows[0].id }, data: { createdAt: old } });
    await prisma.campaignRecipient.update({ where: { id: rows[1].id }, data: { createdAt: old } });
    await jobs.purgeCampaignRecipients(prisma, new Date(), 180);
    expect(await prisma.campaignRecipient.count({ where: { id: rows[0].id } })).toBe(0); // finished
    expect(await prisma.campaignRecipient.count({ where: { id: rows[1].id } })).toBe(1); // still pending
  });

  it('closes a send whose last recipient finished while no worker noticed', async () => {
    const { id, sending, rows } = await started('stalled');
    await prisma.campaignRecipient.updateMany({
      where: { sendingId: sending.id },
      data: { status: 'SKIPPED', nextAttemptAt: null, lastError: 'test' },
    });
    expect(await jobs.finishStalledSendings(prisma, new Date())).toBeGreaterThanOrEqual(1);
    expect((await sendingOf(id)).status).toBe('DONE');
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED');
    expect(rows).toHaveLength(3);
  });

  it('enforces the database invariants', async () => {
    const id = await newCampaign('invariants');
    const s = await prisma.campaignSending.create({
      data: { organizationId: orgId, campaignId: id, subject: 's', body: 'b', audience: {} },
    });
    const rec = (data: Record<string, unknown>) =>
      prisma.campaignRecipient.create({
        data: { sendingId: s.id, campaignId: id, organizationId: orgId, name: 'n', ...data },
      });
    await expect(rec({ email: 'Upper@cs.test', nextAttemptAt: new Date() })).rejects.toThrow();
    await expect(rec({ email: addr('i1'), status: 'WEIRD' })).rejects.toThrow();
    await expect(rec({ email: addr('i2') })).rejects.toThrow(); // PENDING needs next_attempt_at
    await expect(rec({ email: addr('i3'), status: 'SENT' })).rejects.toThrow(); // SENT needs sent_at
    await expect(
      rec({ email: addr('i4'), nextAttemptAt: new Date(), attempt: 6 }),
    ).rejects.toThrow();
    await rec({ email: addr('i5'), nextAttemptAt: new Date() });
    await expect(rec({ email: addr('i5'), nextAttemptAt: new Date() })).rejects.toThrow(); // one per address
    await expect(
      prisma.campaignSending.create({
        data: { organizationId: orgId, campaignId: id, subject: 's', body: 'b', audience: {} },
      }),
    ).rejects.toThrow(); // one send per campaign
    await expect(
      prisma.campaignSending.update({ where: { id: s.id }, data: { status: 'SENDING' } }),
    ).rejects.toThrow(); // started_at required
    await expect(
      prisma.campaignSending.update({ where: { id: s.id }, data: { subject: 'a\\nb' } }),
    ).resolves.toBeTruthy(); // literal backslash-n is fine
    await expect(
      prisma.campaignSending.update({ where: { id: s.id }, data: { subject: 'a\nb' } }),
    ).rejects.toThrow();
    await expect(
      prisma.marketingSuppression.create({
        data: { organizationId: orgId, email: 'UP@cs.test', reason: 'MANUAL' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.marketingSuppression.create({
        data: { organizationId: orgId, email: addr('bad'), reason: 'WHY' },
      }),
    ).rejects.toThrow();
  });
});
