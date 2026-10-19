import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv, TEST_ENV } from './helpers';

/**
 * Full-stack identity tests against a real PostgreSQL (migrations applied).
 * Runs in CI (RUN_DB_TESTS=1); skipped locally without a database.
 */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const NEW_ADMIN_PASSWORD = 'Rotated-Admin-Passw0rd';
const USER_PASSWORD = 'Another-Strong-Passw0rd';

interface Res {
  status: number;
  body: any;
  cookie?: string;
}

describe.skipIf(!run)('identity & access (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let totp: any;
  const roleIds: Record<string, string> = {};
  let adminCookie = '';
  let adminId = '';

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    opts: { body?: unknown; cookie?: string; origin?: string | null } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.origin !== null && method !== 'GET') headers.origin = opts.origin ?? ORIGIN;
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    let body: unknown = undefined;
    try {
      body = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body, cookie: raw?.split(';')[0] };
  }

  const login = (email: string, password: string, totpCode?: string) =>
    call('POST', '/auth/login', { body: { email, password, ...(totpCode ? { totpCode } : {}) } });

  async function createUser(email: string, roleKey: string) {
    const res = await call('POST', '/users', {
      cookie: adminCookie,
      body: {
        email,
        name: `کاربر ${roleKey}`,
        roleId: roleIds[roleKey],
        password: USER_PASSWORD,
        mustChangePassword: false,
      },
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    applyTestEnv();
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { TotpService } = await import('../src/modules/auth/totp.service');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    totp = app.get(TotpService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unauthenticated access', async () => {
    expect((await call('GET', '/users')).status).toBe(401);
    expect((await call('GET', '/auth/me')).status).toBe(401);
  });

  it('bootstrap created the admin; wrong password is rejected generically', async () => {
    const bad = await login(TEST_ENV.BOOTSTRAP_ADMIN_EMAIL, 'definitely-wrong-password');
    expect(bad.status).toBe(401);
    const unknown = await login('nobody@example.com', 'definitely-wrong-password');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });

  it('forces the bootstrap admin to change the temporary password first', async () => {
    const res = await login(TEST_ENV.BOOTSTRAP_ADMIN_EMAIL, TEST_ENV.BOOTSTRAP_ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.cookie).toMatch(/^ishan_sid=/);
    adminCookie = res.cookie!;
    adminId = res.body.user.id;
    expect(res.body.user.mustChangePassword).toBe(true);

    const blocked = await call('GET', '/users', { cookie: adminCookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const change = await call('POST', '/auth/change-password', {
      cookie: adminCookie,
      body: { currentPassword: TEST_ENV.BOOTSTRAP_ADMIN_PASSWORD, newPassword: NEW_ADMIN_PASSWORD },
    });
    expect(change.status).toBe(204);
    expect((await call('GET', '/users', { cookie: adminCookie })).status).toBe(200);
  });

  it('blocks cross-origin and origin-less cookie mutations (CSRF)', async () => {
    const evil = await call('POST', '/teams', {
      cookie: adminCookie,
      origin: 'https://evil.test',
      body: { name: 'x1' },
    });
    expect(evil.status).toBe(403);
    const none = await call('POST', '/teams', {
      cookie: adminCookie,
      origin: null,
      body: { name: 'x2' },
    });
    expect(none.status).toBe(403);
  });

  it('enforces RBAC per role', async () => {
    const roles = await call('GET', '/roles', { cookie: adminCookie });
    for (const r of roles.body) roleIds[r.key] = r.id;
    expect(Object.keys(roleIds)).toEqual(
      expect.arrayContaining(['admin', 'manager', 'sales', 'viewer']),
    );

    await createUser('viewer@example.com', 'viewer');
    await createUser('sales@example.com', 'sales');
    await createUser('manager@example.com', 'manager');

    const viewer = (await login('viewer@example.com', USER_PASSWORD)).cookie!;
    expect((await call('GET', '/auth/me', { cookie: viewer })).status).toBe(200);
    expect((await call('GET', '/users', { cookie: viewer })).status).toBe(403);
    expect((await call('GET', '/teams', { cookie: viewer })).status).toBe(403);
    expect((await call('GET', '/audit-logs', { cookie: viewer })).status).toBe(403);

    const sales = (await login('sales@example.com', USER_PASSWORD)).cookie!;
    expect((await call('GET', '/teams', { cookie: sales })).status).toBe(200);
    expect(
      (await call('POST', '/teams', { cookie: sales, body: { name: 'نباید ساخته شود' } })).status,
    ).toBe(403);
    expect((await call('POST', '/users', { cookie: sales, body: {} })).status).toBe(403);

    const manager = (await login('manager@example.com', USER_PASSWORD)).cookie!;
    expect((await call('GET', '/users', { cookie: manager })).status).toBe(200);
    expect((await call('POST', '/users', { cookie: manager, body: {} })).status).toBe(403);
    expect((await call('POST', '/roles', { cookie: manager, body: {} })).status).toBe(403);
    expect((await call('GET', '/audit-logs', { cookie: manager })).status).toBe(200);
  });

  it('validates input and rejects duplicates', async () => {
    const weak = await call('POST', '/users', {
      cookie: adminCookie,
      body: { email: 'weak@example.com', name: 'Weak', roleId: roleIds.viewer, password: 'short' },
    });
    expect(weak.status).toBe(400);
    const dup = await call('POST', '/users', {
      cookie: adminCookie,
      body: {
        email: 'viewer@example.com',
        name: 'Dup',
        roleId: roleIds.viewer,
        password: USER_PASSWORD,
      },
    });
    expect(dup.status).toBe(409);
  });

  it('manages teams and members', async () => {
    const team = await call('POST', '/teams', {
      cookie: adminCookie,
      body: { name: 'فروش تهران' },
    });
    expect(team.status).toBe(201);
    const salesUser = (await call('GET', '/users?q=sales', { cookie: adminCookie })).body.items[0];
    expect(
      (
        await call('PUT', `/teams/${team.body.id}/members`, {
          cookie: adminCookie,
          body: { userId: salesUser.id, role: 'LEAD' },
        })
      ).status,
    ).toBe(204);
    const detail = await call('GET', `/teams/${team.body.id}`, { cookie: adminCookie });
    expect(detail.body.members).toHaveLength(1);
    expect(detail.body.members[0].role).toBe('LEAD');
    expect(
      (await call('POST', '/teams', { cookie: adminCookie, body: { name: 'فروش تهران' } })).status,
    ).toBe(409);
    expect(
      (
        await call('DELETE', `/teams/${team.body.id}/members/${salesUser.id}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(204);
    expect((await call('DELETE', `/teams/${team.body.id}`, { cookie: adminCookie })).status).toBe(
      204,
    );
    expect((await call('GET', `/teams/${team.body.id}`, { cookie: adminCookie })).status).toBe(404);
  });

  it('manages custom roles and protects system roles', async () => {
    const created = await call('POST', '/roles', {
      cookie: adminCookie,
      body: { key: 'auditor', name: 'ممیز', permissions: ['audit.read'] },
    });
    expect(created.status).toBe(201);
    const bad = await call('POST', '/roles', {
      cookie: adminCookie,
      body: { key: 'bogus', name: 'x1', permissions: ['not.a.permission'] },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await call('PATCH', `/roles/${roleIds.admin}`, {
          cookie: adminCookie,
          body: { name: 'hacked' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('DELETE', `/roles/${created.body.id}`, { cookie: adminCookie })).status,
    ).toBe(204);
  });

  it('protects the last admin and self-lockout', async () => {
    const self = await call('PATCH', `/users/${adminId}`, {
      cookie: adminCookie,
      body: { status: 'DISABLED' },
    });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_DISABLE_SELF');
    const demote = await call('PATCH', `/users/${adminId}`, {
      cookie: adminCookie,
      body: { roleId: roleIds.viewer },
    });
    expect(demote.status).toBe(400);
    expect(demote.body.error.code).toBe('LAST_ADMIN');
  });

  it('disabling a user revokes their sessions immediately', async () => {
    const id = await createUser('temp@example.com', 'viewer');
    const cookie = (await login('temp@example.com', USER_PASSWORD)).cookie!;
    expect((await call('GET', '/auth/me', { cookie })).status).toBe(200);
    expect(
      (await call('PATCH', `/users/${id}`, { cookie: adminCookie, body: { status: 'DISABLED' } }))
        .status,
    ).toBe(200);
    expect((await call('GET', '/auth/me', { cookie })).status).toBe(401);
    expect((await login('temp@example.com', USER_PASSWORD)).status).toBe(401);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    await createUser('lock@example.com', 'viewer');
    for (let i = 0; i < 5; i++)
      expect((await login('lock@example.com', 'wrong-password-123')).status).toBe(401);
    expect((await login('lock@example.com', USER_PASSWORD)).status).toBe(401);
    const audit = await call('GET', '/audit-logs?action=auth.lockout', { cookie: adminCookie });
    expect(audit.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('admin can reset a password, which forces a change and kills sessions', async () => {
    const id = await createUser('reset@example.com', 'viewer');
    const old = (await login('reset@example.com', USER_PASSWORD)).cookie!;
    expect(
      (
        await call('POST', `/users/${id}/reset-password`, {
          cookie: adminCookie,
          body: { newPassword: 'Temporary-Passw0rd-1' },
        })
      ).status,
    ).toBe(204);
    expect((await call('GET', '/auth/me', { cookie: old })).status).toBe(401);
    const fresh = await login('reset@example.com', 'Temporary-Passw0rd-1');
    expect(fresh.body.user.mustChangePassword).toBe(true);
  });

  it('supports TOTP MFA enrolment and login', async () => {
    await createUser('mfa@example.com', 'viewer');
    const cookie = (await login('mfa@example.com', USER_PASSWORD)).cookie!;
    const setup = await call('POST', '/auth/mfa/setup', { cookie });
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+$/);
    const stored = await prisma.user.findFirst({ where: { email: 'mfa@example.com' } });
    expect(stored.mfaSecretEnc).not.toContain(setup.body.secret);

    expect(
      (await call('POST', '/auth/mfa/enable', { cookie, body: { code: '000000' } })).status,
    ).toBe(400);
    const code = totp.codeAt(setup.body.secret, Date.now());
    expect((await call('POST', '/auth/mfa/enable', { cookie, body: { code } })).status).toBe(204);

    const step1 = await login('mfa@example.com', USER_PASSWORD);
    expect(step1.body.status).toBe('mfa_required');
    expect(step1.cookie).toBeUndefined();
    expect((await login('mfa@example.com', USER_PASSWORD, '000000')).status).toBe(401);
    const ok = await login(
      'mfa@example.com',
      USER_PASSWORD,
      totp.codeAt(setup.body.secret, Date.now()),
    );
    expect(ok.status).toBe(200);
    expect(ok.cookie).toBeDefined();
  });

  it('logout revokes the session server-side', async () => {
    const cookie = (await login('viewer@example.com', USER_PASSWORD)).cookie!;
    expect((await call('POST', '/auth/logout', { cookie })).status).toBe(204);
    expect((await call('GET', '/auth/me', { cookie })).status).toBe(401);
  });

  it('records sensitive operations in an append-only audit log', async () => {
    const res = await call('GET', '/audit-logs?limit=100', { cookie: adminCookie });
    const actions = new Set(res.body.items.map((i: any) => i.action));
    for (const a of [
      'auth.login',
      'auth.login_failed',
      'user.created',
      'team.created',
      'role.created',
      'auth.password_changed',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    const row = await prisma.auditLog.findFirst();
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
