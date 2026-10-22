import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Customers/contacts/tags/search/import/export against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Customers-Spec-Passw0rd';

interface Res {
  status: number;
  body: any;
  text: string;
  headers: Record<string, any>;
}

describe.skipIf(!run)('customers (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  const cookies: Record<string, string> = {};
  const userIds: string[] = [];
  const emails = ['cust-admin', 'cust-sales', 'cust-viewer', 'cust-manager'].map(
    (n) => `${n}@example.com`,
  );

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
    return { status: res.statusCode, body: parsed, text: res.body, headers: res.headers };
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
    // These specs are about other features: let the sales role see the whole organization (row access has its own spec).
    await prisma.role.updateMany({ where: { key: 'sales' }, data: { dataScope: 'ALL' } });
    const passwords = app.get(PasswordService);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    const hash = await passwords.hash(PASSWORD);
    const roleKeys: Record<string, string> = {
      'cust-admin': 'admin',
      'cust-sales': 'sales',
      'cust-viewer': 'viewer',
      'cust-manager': 'manager',
    };
    for (const email of emails) {
      const name = email.split('@')[0]!;
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: org.id, key: roleKeys[name] },
      });
      const user = await prisma.user.create({
        data: {
          organizationId: org.id,
          roleId: role.id,
          email,
          name,
          passwordHash: hash,
        },
      });
      userIds.push(user.id);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ORIGIN },
        payload: { email, password: PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      const raw = res.headers['set-cookie'];
      cookies[name] = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(';')[0]!;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.customer.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.contact.deleteMany({ where: { customerId: null } });
      await prisma.tag.deleteMany({ where: { name: { startsWith: 'spec-' } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  let customerId = '';
  let tagId = '';

  it('requires authentication and enforces permissions', async () => {
    expect((await call('GET', '/customers', null)).status).toBe(401);
    expect((await call('GET', '/customers', 'cust-viewer')).status).toBe(200);
    const denied = await call('POST', '/customers', 'cust-viewer', {
      kind: 'PERSON',
      name: 'علی کریمی',
    });
    expect(denied.status).toBe(403);
    expect((await call('GET', '/customers/export', 'cust-sales')).status).toBe(403);
    expect((await call('POST', '/customers/import', 'cust-sales', { csv: 'name\nx' })).status).toBe(
      403,
    );
    expect((await call('POST', '/tags', 'cust-viewer', { name: 'spec-x' })).status).toBe(403);
  });

  it('creates and validates customers', async () => {
    const bad = await call('POST', '/customers', 'cust-sales', { kind: 'PERSON', name: 'ا' });
    expect(bad.status).toBe(400);
    const badPhone = await call('POST', '/customers', 'cust-sales', {
      kind: 'PERSON',
      name: 'علی کریمی',
      phone: 'abc',
    });
    expect(badPhone.status).toBe(400);

    const res = await call('POST', '/customers', 'cust-sales', {
      kind: 'PERSON',
      name: 'علي كريمي',
      email: 'Ali@Example.com',
      phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹',
      city: 'تهران',
    });
    expect(res.status).toBe(201);
    customerId = res.body.id;
    expect(res.body.email).toBe('ali@example.com');
    expect(res.body.phone).toBe('09123456789');
    expect(res.body.owner.name).toBe('cust-sales');
  });

  it('searches with Persian normalization (ي/ك and digits)', async () => {
    const a = await call('GET', `/customers?q=${encodeURIComponent('علی کریمی')}`, 'cust-viewer');
    expect(a.body.items.map((c: any) => c.id)).toContain(customerId);
    const b = await call('GET', `/customers?q=${encodeURIComponent('۰۹۱۲۳۴۵')}`, 'cust-viewer');
    expect(b.body.items.map((c: any) => c.id)).toContain(customerId);
    const none = await call('GET', '/customers?q=zzzzqqqq', 'cust-viewer');
    expect(none.body.items).toHaveLength(0);
    const g = await call('GET', `/search?q=${encodeURIComponent('کریمی')}`, 'cust-viewer');
    expect(g.body.customers.map((c: any) => c.id)).toContain(customerId);
  });

  it('updates, clears optional fields, and records audit', async () => {
    const res = await call('PATCH', `/customers/${customerId}`, 'cust-sales', {
      city: null,
      website: 'https://example.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.city).toBeNull();
    const logs = await call('GET', '/audit-logs?action=customer.updated', 'cust-admin');
    expect(logs.body.items.some((l: any) => l.entityId === customerId)).toBe(true);
  });

  it('manages tags and filters by tag', async () => {
    const t = await call('POST', '/tags', 'cust-sales', { name: 'spec-vip', color: '#ff0000' });
    expect(t.status).toBe(201);
    tagId = t.body.id;
    expect((await call('POST', '/tags', 'cust-sales', { name: 'spec-vip' })).status).toBe(409);
    expect(
      (await call('POST', '/tags', 'cust-sales', { name: 'spec-b', color: 'red' })).status,
    ).toBe(400);
    const set = await call('PUT', `/customers/${customerId}/tags`, 'cust-sales', {
      tagIds: [tagId],
    });
    expect(set.body.tags.map((x: any) => x.name)).toEqual(['spec-vip']);
    const bogus = await call('PUT', `/customers/${customerId}/tags`, 'cust-sales', {
      tagIds: ['0197c0de-0000-7000-8000-000000000000'],
    });
    expect(bogus.status).toBe(400);
    const filtered = await call('GET', `/customers?tagId=${tagId}`, 'cust-viewer');
    expect(filtered.body.items).toHaveLength(1);
  });

  it('manages contacts with a single primary', async () => {
    const c1 = await call('POST', `/customers/${customerId}/contacts`, 'cust-sales', {
      firstName: 'سارا',
      lastName: 'احمدی',
      mobile: '09120000001',
      isPrimary: true,
    });
    expect(c1.status).toBe(201);
    const c2 = await call('POST', `/customers/${customerId}/contacts`, 'cust-sales', {
      firstName: 'رضا',
      lastName: 'موسوی',
      isPrimary: true,
    });
    expect(c2.status).toBe(201);
    const detail = await call('GET', `/customers/${customerId}`, 'cust-viewer');
    expect(detail.body.contacts).toHaveLength(2);
    expect(detail.body.contacts.filter((c: any) => c.isPrimary)).toHaveLength(1);
    expect(detail.body.contacts[0].id).toBe(c2.body.id);
    const upd = await call('PATCH', `/contacts/${c1.body.id}`, 'cust-sales', { jobTitle: 'مدیر' });
    expect(upd.body.jobTitle).toBe('مدیر');
    expect((await call('DELETE', `/contacts/${c1.body.id}`, 'cust-sales')).status).toBe(204);
    expect((await call('PATCH', `/contacts/${c1.body.id}`, 'cust-sales', {})).status).toBe(404);
  });

  it('imports CSV with a dry run, validation errors and duplicate skipping', async () => {
    const csv =
      'kind,name,email,phone\r\n' +
      'PERSON,"نیلوفر, مهدوی",nil@example.com,09121111111\r\n' +
      'حقوقی,شرکت آلفا,alpha@example.com,\r\n' +
      'PERSON,ا,bad@example.com,\r\n' +
      'PERSON,تکراری,ali@example.com,\r\n';
    const dry = await call('POST', '/customers/import', 'cust-admin', { csv, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ total: 4, created: 2, skipped: 1, dryRun: true });
    expect(dry.body.errors.map((e: any) => e.row).sort()).toEqual([4, 5]);
    expect((await call('GET', '/customers?q=alpha', 'cust-viewer')).body.items).toHaveLength(0);

    const real = await call('POST', '/customers/import', 'cust-admin', { csv, dryRun: false });
    expect(real.body.created).toBe(2);
    const again = await call('POST', '/customers/import', 'cust-admin', { csv, dryRun: false });
    expect(again.body.created).toBe(0);
    const found = await call('GET', '/customers?q=alpha', 'cust-viewer');
    expect(found.body.items[0].kind).toBe('ORGANIZATION');
    expect(
      (
        await call('POST', '/customers/import', 'cust-admin', {
          csv: 'email\na@b.co',
          dryRun: true,
        })
      ).status,
    ).toBe(400);
  });

  it('exports CSV safely (formula injection neutralized)', async () => {
    const made = await call('POST', '/customers', 'cust-admin', {
      kind: 'PERSON',
      name: '=HYPERLINK("http://evil")',
    });
    expect(made.status).toBe(201);
    const res = await call('GET', '/customers/export', 'cust-admin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('kind,name');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('guards concurrent edits with ETag / If-Match', async () => {
    const created = await call('POST', '/customers', 'cust-sales', {
      kind: 'PERSON',
      name: 'همزمانی آزمون',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const first = await call('GET', `/customers/${id}`, 'cust-sales');
    const tag = first.headers.etag as string;
    expect(tag).toMatch(/^"\d+"$/);

    // someone else saves first
    await new Promise((r) => setTimeout(r, 5));
    const other = await call('PATCH', `/customers/${id}`, 'cust-manager', { name: 'نسخه دیگر' });
    expect(other.status).toBe(200);

    // the stale form is refused and nothing is overwritten
    const stale = await call(
      'PATCH',
      `/customers/${id}`,
      'cust-sales',
      { name: 'قدیمی' },
      { 'if-match': tag },
    );
    expect(stale.status).toBe(412);
    expect(stale.body.error.code).toBe('STALE_ENTITY');
    expect((await call('GET', `/customers/${id}`, 'cust-sales')).body.name).toBe('نسخه دیگر');

    // with the fresh tag (or none) the write goes through and the tag moves on
    const fresh = other.headers.etag as string;
    const ok = await call(
      'PATCH',
      `/customers/${id}`,
      'cust-sales',
      { name: 'جدید' },
      { 'if-match': fresh },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.etag).not.toBe(fresh);
    expect((await call('PATCH', `/customers/${id}`, 'cust-sales', { city: 'تهران' })).status).toBe(
      200,
    );
  });

  it('soft-deletes with the delete permission only', async () => {
    expect((await call('DELETE', `/customers/${customerId}`, 'cust-sales')).status).toBe(403);
    expect((await call('DELETE', `/customers/${customerId}`, 'cust-manager')).status).toBe(204);
    expect((await call('GET', `/customers/${customerId}`, 'cust-viewer')).status).toBe(404);
    const list = await call('GET', '/customers?q=کریمی', 'cust-viewer');
    expect(list.body.items.map((c: any) => c.id)).not.toContain(customerId);
  });
});
