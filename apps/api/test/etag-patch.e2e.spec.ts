import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** If-Match on the remaining PATCH endpoints (ADR 0009). Real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'EtagPatch-Spec-Passw0rd';

interface Res {
  status: number;
  body: any;
  headers: Record<string, any>;
}

describe.skipIf(!run)('If-Match on PATCH (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let cookie = '';
  const created = { users: [] as string[], roles: [] as string[] };
  let orgId = '';
  let customerId = '';

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Res> {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { cookie, ...(method !== 'GET' ? { origin: ORIGIN } : {}), ...extra },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    let parsed: any;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = undefined;
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  beforeAll(async () => {
    applyTestEnv();
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { PasswordService } = await import('../src/modules/auth/password.service');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    const hash = await app.get(PasswordService).hash(PASSWORD);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    orgId = org.id;
    const admin = await prisma.role.findFirstOrThrow({
      where: { organizationId: org.id, key: 'admin' },
    });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        roleId: admin.id,
        email: 'etag-admin@example.com',
        name: 'etag-admin',
        passwordHash: hash,
      },
    });
    created.users.push(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'etag-admin@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const raw = res.headers['set-cookie'];
    cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(';')[0]!;
    customerId = (await call('POST', '/customers', { kind: 'PERSON', name: 'مشتری ETag' })).body.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.activity.deleteMany({ where: { createdById: { in: created.users } } });
      await prisma.campaign.deleteMany({ where: { createdById: { in: created.users } } });
      await prisma.customer.deleteMany({ where: { createdById: { in: created.users } } });
      await prisma.product.deleteMany({ where: { name: { startsWith: 'etag-' } } });
      await prisma.team.deleteMany({ where: { name: { startsWith: 'etag-' } } });
      await prisma.role.deleteMany({ where: { id: { in: created.roles } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    }
    await app?.close();
  });

  const tagOf = (updatedAt: string | Date) => `"${new Date(updatedAt).getTime()}"`;

  /** Each case: create a row, then PATCH `change` through the API. */
  const cases: Array<{
    name: string;
    make: () => Promise<{ id: string; updatedAt: string | Date }>;
    path: (id: string) => string;
    change: Record<string, unknown>;
    other: Record<string, unknown>;
  }> = [
    {
      name: 'contacts',
      make: async () =>
        (
          await call('POST', `/customers/${customerId}/contacts`, {
            firstName: 'علی',
            lastName: 'رضایی',
          })
        ).body,
      path: (id) => `/contacts/${id}`,
      change: { jobTitle: 'مدیر' },
      other: { jobTitle: 'معاون' },
    },
    {
      name: 'products',
      make: async () =>
        (await call('POST', '/products', { name: `etag-${Date.now()}`, unitPrice: '1000' })).body,
      path: (id) => `/products/${id}`,
      change: { description: 'الف' },
      other: { description: 'ب' },
    },
    {
      name: 'campaigns',
      make: async () => (await call('POST', '/campaigns', { name: 'کمپین ETag' })).body,
      path: (id) => `/campaigns/${id}`,
      change: { notes: 'الف' },
      other: { notes: 'ب' },
    },
    {
      name: 'activities',
      make: async () =>
        (await call('POST', '/activities', { type: 'NOTE', description: 'یادداشت ETag' })).body,
      path: (id) => `/activities/${id}`,
      change: { description: 'الف' },
      other: { description: 'ب' },
    },
    {
      name: 'teams',
      make: async () => (await call('POST', '/teams', { name: `etag-${Date.now()}` })).body,
      path: (id) => `/teams/${id}`,
      change: { description: 'الف' },
      other: { description: 'ب' },
    },
    {
      name: 'users',
      make: async () => {
        const admin = await prisma.role.findFirstOrThrow({
          where: { organizationId: orgId, key: 'viewer' },
        });
        const u = await prisma.user.create({
          data: {
            organizationId: orgId,
            roleId: admin.id,
            email: `etag-u-${Date.now()}@example.com`,
            name: 'etag-user',
            passwordHash: 'x',
          },
        });
        created.users.push(u.id);
        return u;
      },
      path: (id) => `/users/${id}`,
      change: { name: 'نام الف' },
      other: { name: 'نام ب' },
    },
    {
      name: 'roles',
      make: async () => {
        const r = await prisma.role.create({
          data: {
            organizationId: orgId,
            key: `etag-${Date.now()}`,
            name: 'etag-role',
            permissions: [],
          },
        });
        created.roles.push(r.id);
        return r;
      },
      path: (id) => `/roles/${id}`,
      change: { description: 'الف' },
      other: { description: 'ب' },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: current tag succeeds, the old tag is refused, no header keeps last-write-wins`, async () => {
      const row = await c.make();
      expect(row.id).toBeTruthy();
      const first = tagOf(row.updatedAt);

      const ok = await call('PATCH', c.path(row.id), c.change, { 'if-match': first });
      expect(ok.status).toBe(200);
      expect(ok.body.updatedAt).toBeTruthy();
      const second = ok.headers.etag as string;
      expect(second).toBe(tagOf(ok.body.updatedAt));
      expect(second).not.toBe(first);

      const stale = await call('PATCH', c.path(row.id), c.other, { 'if-match': first });
      expect(stale.status).toBe(412);
      expect(stale.body.code ?? stale.body.error?.code).toBe('STALE_ENTITY');

      const fresh = await call('PATCH', c.path(row.id), c.other, { 'if-match': second });
      expect(fresh.status).toBe(200);

      const legacy = await call('PATCH', c.path(row.id), c.change);
      expect(legacy.status).toBe(200);
    });
  }

  it('two writers racing on one tag: exactly one wins', async () => {
    const row = (
      await call('POST', `/customers/${customerId}/contacts`, { firstName: 'رقابت', lastName: 'ف' })
    ).body;
    const tag = tagOf(row.updatedAt);
    const [a, b] = await Promise.all([
      call('PATCH', `/contacts/${row.id}`, { jobTitle: 'الف' }, { 'if-match': tag }),
      call('PATCH', `/contacts/${row.id}`, { jobTitle: 'ب' }, { 'if-match': tag }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 412]);
  });

  it('a stale contact write does not demote the current primary contact', async () => {
    const a = (
      await call('POST', `/customers/${customerId}/contacts`, {
        firstName: 'اصلی',
        lastName: 'یک',
        isPrimary: true,
      })
    ).body;
    const b = (
      await call('POST', `/customers/${customerId}/contacts`, { firstName: 'فرعی', lastName: 'دو' })
    ).body;
    const stale = await call(
      'PATCH',
      `/contacts/${b.id}`,
      { isPrimary: true },
      { 'if-match': '"1"' },
    );
    expect(stale.status).toBe(412);
    const rows = await prisma.contact.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.find((r: any) => r.id === a.id).isPrimary).toBe(true);
    expect(rows.find((r: any) => r.id === b.id).isPrimary).toBe(false);
  });
});
