import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyTestEnv } from './helpers';

/** Admin edits a user's e-mail (ADR 0020). Real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'UserEmail-Spec-Passw0rd';
const TOKEN = 'ue-spec-token-0123456789-abcdefghijklmnop';

interface Res {
  status: number;
  body: any;
}

describe.skipIf(!run)('admin edits a user e-mail (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let sha256Hex: (v: string) => string;
  let orgId = '';
  let adminCookie = '';
  let viewerRoleId = '';
  const userIds: string[] = [];
  let passwordHash = '';
  let mailer: any;
  let sent: any[] = [];

  async function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body?: unknown,
  ): Promise<Res> {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin: ORIGIN } : {}) },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    let parsed: any;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = undefined;
    }
    return { status: res.statusCode, body: parsed };
  }

  async function login(email: string): Promise<{ status: number; cookie: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email, password: PASSWORD },
    });
    const raw = res.headers['set-cookie'];
    const cookie = raw ? (Array.isArray(raw) ? raw[0]! : (raw as string)).split(';')[0]! : '';
    return { status: res.statusCode, cookie };
  }

  async function makeUser(name: string, verified: boolean) {
    const u = await prisma.user.create({
      data: {
        organizationId: orgId,
        roleId: viewerRoleId,
        email: `${name}@example.com`,
        name,
        passwordHash,
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
    userIds.push(u.id);
    return u;
  }

  beforeAll(async () => {
    applyTestEnv();
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { PasswordService } = await import('../src/modules/auth/password.service');
    const { CryptoService } = await import('../src/modules/auth/crypto.service');
    sha256Hex = CryptoService.sha256Hex;
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    const { MailerService } = await import('../src/modules/notifications/mailer.service');
    mailer = app.get(MailerService);
    passwordHash = await app.get(PasswordService).hash(PASSWORD);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    orgId = org.id;
    viewerRoleId = (
      await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, key: 'viewer' } })
    ).id;
    const adminRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: orgId, key: 'admin' },
    });
    const admin = await prisma.user.create({
      data: {
        organizationId: orgId,
        roleId: adminRole.id,
        email: 'ue-admin@example.com',
        name: 'ue-admin',
        passwordHash,
      },
    });
    userIds.push(admin.id);
    const l = await login('ue-admin@example.com');
    expect(l.status).toBe(200);
    adminCookie = l.cookie;
  });

  afterAll(async () => {
    if (prisma) {
      // audit_logs is append-only: its rows stay, by design.
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('changing the address clears verification, voids old links, signs the person out and moves the login', async () => {
    const u = await makeUser('ue-target', true);
    await prisma.emailVerificationToken.create({
      data: {
        userId: u.id,
        tokenHash: sha256Hex(TOKEN),
        email: u.email,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const session = await login('ue-target@example.com');
    expect(session.status).toBe(200);
    expect((await call('GET', '/auth/me', session.cookie)).status).toBe(200);

    const res = await call('PATCH', `/users/${u.id}`, adminCookie, {
      email: '  UE-Moved@Example.com ',
    });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('ue-moved@example.com');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.emailVerifiedAt).toBeNull();
    const token = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: u.id } });
    expect(token.usedAt).not.toBeNull();
    expect((await call('POST', '/auth/verify-email', null, { token: TOKEN })).status).toBe(400);

    expect((await call('GET', '/auth/me', session.cookie)).status).toBe(401);
    expect((await login('ue-target@example.com')).status).toBe(401);
    expect((await login('ue-moved@example.com')).status).toBe(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: u.id, action: 'user.email_changed' },
    });
    expect(audit.actorId).toBe(userIds[0]);
    expect(audit.metadata).toEqual({ from: 'ue-target@example.com', to: 'ue-moved@example.com' });
  });

  it('tells the previous address, masked and without a link; never fails or blocks the change', async () => {
    vi.spyOn(mailer, 'available', 'get').mockReturnValue(true);
    const send = vi.spyOn(mailer, 'send').mockImplementation(async (m: any) => {
      sent.push(m);
    });
    sent = [];
    const u = await makeUser('ue-notice', true);
    const ok = await call('PATCH', `/users/${u.id}`, adminCookie, {
      email: 'ue-notice-new@example.com',
    });
    expect(ok.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ue-notice@example.com');
    expect(`${sent[0].text}${sent[0].html}`).not.toContain('ue-notice-new');
    expect(sent[0].text).toContain('u***@example.com');

    // A failing mail channel must not undo or fail the change.
    send.mockRejectedValue(new Error('smtp down'));
    const again = await call('PATCH', `/users/${u.id}`, adminCookie, {
      email: 'ue-notice-newer@example.com',
    });
    expect(again.status).toBe(200);
    expect(again.body.email).toBe('ue-notice-newer@example.com');

    // Nothing is sent when the address does not change, or when there is no mail channel.
    send.mockClear();
    await call('PATCH', `/users/${u.id}`, adminCookie, { name: 'نام دیگر' });
    expect(send).not.toHaveBeenCalled();
    vi.spyOn(mailer, 'available', 'get').mockReturnValue(false);
    await call('PATCH', `/users/${u.id}`, adminCookie, { email: 'ue-notice-last@example.com' });
    expect(send).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('refuses an address that is already taken and changes nothing', async () => {
    const a = await makeUser('ue-a', true);
    await makeUser('ue-b', false);
    const res = await call('PATCH', `/users/${a.id}`, adminCookie, { email: 'ue-b@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.code ?? res.body.error?.code).toBe('EMAIL_TAKEN');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.email).toBe('ue-a@example.com');
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it('the same address (any case) keeps verification and sessions', async () => {
    const u = await makeUser('ue-same', true);
    const session = await login('ue-same@example.com');
    const res = await call('PATCH', `/users/${u.id}`, adminCookie, {
      email: 'UE-SAME@example.com',
      name: 'نام تازه',
    });
    expect(res.status).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt,
    ).not.toBeNull();
    expect((await call('GET', '/auth/me', session.cookie)).status).toBe(200);
    expect(
      await prisma.auditLog.count({ where: { entityId: u.id, action: 'user.email_changed' } }),
    ).toBe(0);
  });

  it('an admin cannot change their own address here', async () => {
    const res = await call('PATCH', `/users/${userIds[0]}`, adminCookie, {
      email: 'ue-admin2@example.com',
    });
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.error?.code).toBe('CANNOT_CHANGE_OWN_EMAIL');
    expect((await call('GET', '/auth/me', adminCookie)).status).toBe(200);
  });

  it('rejects a malformed address and requires the users.write permission', async () => {
    const u = await makeUser('ue-bad', false);
    expect(
      (await call('PATCH', `/users/${u.id}`, adminCookie, { email: 'not-an-email' })).status,
    ).toBe(400);
    const viewer = await login('ue-bad@example.com');
    expect(
      (await call('PATCH', `/users/${u.id}`, viewer.cookie, { email: 'ue-x@example.com' })).status,
    ).toBe(403);
  });
});
