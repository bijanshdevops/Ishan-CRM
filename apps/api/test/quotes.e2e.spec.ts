import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Products, quotes and contracts against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Quotes-Spec-Passw0rd';
const DAY = 24 * 60 * 60_000;
const ymd = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().slice(0, 10);

interface Res {
  status: number;
  body: any;
}

describe.skipIf(!run)('products, quotes and contracts (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'q-manager': 'manager',
    'q-sales': 'sales',
    'q-viewer': 'viewer',
  };
  const tag = Date.now().toString(36);
  let customerId = '';
  let otherCustomerId = '';
  let contactOfOther = '';

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
      userIds[name] = user.id;
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
    const mkCustomer = (name: string) =>
      prisma.customer.create({
        data: {
          organizationId: org.id,
          kind: 'ORGANIZATION',
          name,
          searchText: name,
          createdById: userIds['q-manager'],
        },
      });
    customerId = (await mkCustomer(`مشتری پیشنهاد ${tag}`)).id;
    otherCustomerId = (await mkCustomer(`مشتری دیگر ${tag}`)).id;
    contactOfOther = (
      await prisma.contact.create({
        data: {
          organizationId: org.id,
          customerId: otherCustomerId,
          firstName: 'مخاطب',
          lastName: 'دیگر',
          searchText: 'مخاطب دیگر',
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (prisma) {
      const ids = Object.values(userIds);
      await prisma.domainEvent.deleteMany({ where: { actorId: { in: ids } } });
      await prisma.contract.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.quote.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.product.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.contact.deleteMany({ where: { customer: { createdById: { in: ids } } } });
      await prisma.customer.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  const quoteBody = (extra: Record<string, unknown> = {}) => ({
    title: `پیشنهاد ${tag}`,
    customerId,
    items: [
      { description: 'خدمت الف', quantity: 2, unitPrice: '1000000' },
      { description: 'خدمت ب', quantity: 1, unitPrice: '500000' },
    ],
    discount: '500000',
    ...extra,
  });
  const newQuote = async (extra: Record<string, unknown> = {}, who = 'q-sales') => {
    const res = await call('POST', '/quotes', who, quoteBody(extra));
    expect(res.status).toBe(201);
    return res.body;
  };
  const send = (id: string) => call('POST', `/quotes/${id}/status`, 'q-sales', { status: 'SENT' });

  it('requires authentication and the right permission for every endpoint', async () => {
    for (const [m, u] of [
      ['GET', '/products'],
      ['GET', '/quotes'],
      ['GET', '/contracts'],
    ] as const) {
      expect((await call(m, u, null)).status).toBe(401);
    }
    const id = '0192f2a0-0000-7000-8000-000000000000';
    // viewer: read only
    for (const u of ['/products', '/quotes', '/contracts']) {
      expect((await call('GET', u, 'q-viewer')).status).toBe(200);
    }
    expect(
      (await call('POST', '/products', 'q-viewer', { name: 'x', unitPrice: '1' })).status,
    ).toBe(403);
    expect((await call('POST', '/quotes', 'q-viewer', quoteBody())).status).toBe(403);
    expect(
      (await call('POST', `/quotes/${id}/status`, 'q-viewer', { status: 'SENT' })).status,
    ).toBe(403);
    expect((await call('POST', `/quotes/${id}/revise`, 'q-viewer')).status).toBe(403);
    expect((await call('DELETE', `/quotes/${id}`, 'q-viewer')).status).toBe(403);
    expect((await call('POST', '/contracts', 'q-viewer', { quoteId: id })).status).toBe(403);
    expect((await call('POST', `/contracts/${id}/activate`, 'q-viewer')).status).toBe(403);
    // sales: manages quotes but not the catalog, quote deletion or contracts
    expect(
      (await call('POST', '/products', 'q-sales', { name: 'xx', unitPrice: '1' })).status,
    ).toBe(403);
    expect((await call('DELETE', `/quotes/${id}`, 'q-sales')).status).toBe(403);
    expect((await call('POST', '/contracts', 'q-sales', { quoteId: id })).status).toBe(403);
    expect((await call('GET', '/contracts', 'q-sales')).status).toBe(200);
    // unknown ids are a clean 404 for permitted users
    expect((await call('GET', `/quotes/${id}`, 'q-manager')).status).toBe(404);
    expect((await call('GET', '/quotes/not-a-uuid', 'q-manager')).status).toBe(400);
  });

  it('manages the product catalog: unique sku, validation, archive', async () => {
    const sku = `SKU-${tag}`;
    const created = await call('POST', '/products', 'q-manager', {
      name: `محصول ${tag}`,
      sku,
      unit: 'ماه',
      unitPrice: '2500000',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ sku, unit: 'ماه', unitPrice: '2500000', active: true });
    expect(
      (await call('POST', '/products', 'q-manager', { name: 'تکراری', sku, unitPrice: '1' }))
        .status,
    ).toBe(409);
    expect(
      (await call('POST', '/products', 'q-manager', { name: 'منفی', unitPrice: '-5' })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/products', 'q-manager', { name: 'عدد', unitPrice: '1.5' })).status,
    ).toBe(400);
    const patched = await call('PATCH', `/products/${created.body.id}`, 'q-manager', {
      unitPrice: '3000000',
    });
    expect(patched.body.unitPrice).toBe('3000000');
    await call('PATCH', `/products/${created.body.id}`, 'q-manager', { active: false });
    const all = await call('GET', `/products?q=${encodeURIComponent(`محصول ${tag}`)}`, 'q-sales');
    expect(all.body.items.map((p: any) => p.id)).toContain(created.body.id);
    const activeOnly = await call(
      'GET',
      `/products?activeOnly=true&q=${encodeURIComponent(`محصول ${tag}`)}`,
      'q-sales',
    );
    expect(activeOnly.body.items.map((p: any) => p.id)).not.toContain(created.body.id);
  });

  it('creates quotes with exact totals and strictly increasing numbers', async () => {
    const a = await newQuote();
    expect(a).toMatchObject({
      version: 1,
      status: 'DRAFT',
      subtotal: '2500000',
      discount: '500000',
      taxRateBp: 1000,
      taxAmount: '200000',
      total: '2200000',
      expired: false,
    });
    expect(a.number).toMatch(/^QT-\d{6}$/);
    expect(a.items.map((i: any) => [i.description, i.lineTotal])).toEqual([
      ['خدمت الف', '2000000'],
      ['خدمت ب', '500000'],
    ]);
    const b = await newQuote();
    expect(Number(b.number.slice(3))).toBe(Number(a.number.slice(3)) + 1);
  });

  it('hands out distinct sequential numbers under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => newQuote()));
    const nums = results.map((r) => Number(r.number.slice(3))).sort((x, y) => x - y);
    expect(new Set(nums).size).toBe(6);
    expect(nums[5]! - nums[0]!).toBe(5);
  });

  it('rejects invalid quotes', async () => {
    const bad = (extra: Record<string, unknown>) =>
      call('POST', '/quotes', 'q-sales', quoteBody(extra));
    expect((await bad({ discount: '9999999999' })).status).toBe(400);
    expect((await bad({ items: [] })).status).toBe(400);
    expect((await bad({ taxRateBp: 20000 })).status).toBe(400);
    expect((await bad({ issueDate: '2026-05-02', validUntil: '2026-05-01' })).status).toBe(400);
    expect((await bad({ customerId: '0192f2a0-0000-7000-8000-000000000000' })).status).toBe(400);
    expect((await bad({ contactId: contactOfOther })).status).toBe(400); // belongs to another customer
    expect(
      (
        await bad({
          items: [
            {
              productId: '0192f2a0-0000-7000-8000-000000000000',
              description: 'x',
              quantity: 1,
              unitPrice: '1',
            },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await bad({ unknownField: 1 })).status).toBe(400);
  });

  it('enforces money invariants in the database itself', async () => {
    const q = await newQuote();
    await expect(
      prisma.quote.update({ where: { id: q.id }, data: { total: 1n } }),
    ).rejects.toThrow();
    await expect(
      prisma.quoteItem.update({ where: { id: q.items[0].id }, data: { lineTotal: 1n } }),
    ).rejects.toThrow();
  });

  it('edits drafts (recomputing totals), locks them once sent, and rejects illegal transitions', async () => {
    const q = await newQuote();
    const edited = await call('PATCH', `/quotes/${q.id}`, 'q-sales', {
      items: [{ description: 'فقط یک قلم', quantity: 3, unitPrice: '1000' }],
      discount: '0',
      taxRateBp: 900,
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ subtotal: '3000', taxAmount: '270', total: '3270' });
    expect(edited.body.items).toHaveLength(1);
    expect(
      (await call('POST', `/quotes/${q.id}/status`, 'q-sales', { status: 'ACCEPTED' })).status,
    ).toBe(409);
    expect((await send(q.id)).body.status).toBe('SENT');
    expect((await send(q.id)).status).toBe(409);
    expect(
      (await call('PATCH', `/quotes/${q.id}`, 'q-sales', { title: 'تغییر ممنوع' })).status,
    ).toBe(409);
    expect((await call('DELETE', `/quotes/${q.id}`, 'q-manager')).status).toBe(409);
  });

  it('revises a sent quote into a new version and keeps the number', async () => {
    const q = await newQuote();
    expect((await call('POST', `/quotes/${q.id}/revise`, 'q-sales')).status).toBe(409); // still a draft
    await send(q.id);
    const rev = await call('POST', `/quotes/${q.id}/revise`, 'q-sales');
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({
      number: q.number,
      version: 2,
      status: 'DRAFT',
      total: q.total,
    });
    expect(rev.body.id).not.toBe(q.id);
    const old = await call('GET', `/quotes/${q.id}`, 'q-sales');
    expect(old.body).toMatchObject({ status: 'SUPERSEDED', latestVersion: 2 });
    const list = await call('GET', `/quotes?q=${q.number}`, 'q-sales');
    expect(list.body.items.map((i: any) => i.id)).toEqual([rev.body.id]);
    const hist = await call('GET', `/quotes?history=true&q=${q.number}`, 'q-sales');
    expect(hist.body.items).toHaveLength(2);
    const versions = await call('GET', `/quotes/${q.id}/versions`, 'q-sales');
    expect(versions.body.map((v: any) => v.version)).toEqual([2, 1]);
    // the new draft is editable again
    expect(
      (await call('PATCH', `/quotes/${rev.body.id}`, 'q-sales', { title: 'نسخه دوم' })).status,
    ).toBe(200);
  });

  it('allows only one of two concurrent revisions', async () => {
    const q = await newQuote();
    await send(q.id);
    const [r1, r2] = await Promise.all([
      call('POST', `/quotes/${q.id}/revise`, 'q-sales'),
      call('POST', `/quotes/${q.id}/revise`, 'q-sales'),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const versions = await call('GET', `/quotes/${q.id}/versions`, 'q-sales');
    expect(versions.body.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it('treats an overdue sent quote as expired and refuses acceptance', async () => {
    const q = await newQuote({ issueDate: ymd(-10 * DAY), validUntil: ymd(-3 * DAY) });
    await send(q.id);
    const got = await call('GET', `/quotes/${q.id}`, 'q-sales');
    expect(got.body.expired).toBe(true);
    const accept = await call('POST', `/quotes/${q.id}/status`, 'q-sales', { status: 'ACCEPTED' });
    expect(accept.status).toBe(409);
    expect(accept.body.error?.code ?? accept.body.code).toBe('QUOTE_EXPIRED');
    // rejected quotes can be revised
    expect(
      (await call('POST', `/quotes/${q.id}/status`, 'q-sales', { status: 'REJECTED' })).status,
    ).toBe(200);
    expect((await call('POST', `/quotes/${q.id}/revise`, 'q-sales')).status).toBe(201);
  });

  it('turns an accepted quote into one contract and runs its lifecycle', async () => {
    const q = await newQuote();
    // not accepted yet → no contract
    expect((await call('POST', '/contracts', 'q-manager', { quoteId: q.id })).status).toBe(409);
    await send(q.id);
    expect(
      (await call('POST', `/quotes/${q.id}/status`, 'q-sales', { status: 'ACCEPTED' })).body.status,
    ).toBe('ACCEPTED');
    const accepted = await prisma.domainEvent.findMany({
      where: { type: 'quote.accepted', entityId: q.id },
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].payload).toMatchObject({ customerId });
    expect((await call('POST', `/quotes/${q.id}/revise`, 'q-sales')).status).toBe(409); // accepted is final
    const c = await call('POST', '/contracts', 'q-manager', {
      quoteId: q.id,
      startDate: ymd(),
      endDate: ymd(365 * DAY),
    });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({
      status: 'DRAFT',
      amount: q.total,
      title: q.title,
      quote: { id: q.id, number: q.number, version: 1 },
      customer: { id: customerId },
    });
    expect(c.body.number).toMatch(/^CT-\d{6}$/);
    expect((await call('POST', '/contracts', 'q-manager', { quoteId: q.id })).status).toBe(409); // one per quote
    expect((await call('GET', `/quotes/${q.id}`, 'q-sales')).body.contract).toMatchObject({
      id: c.body.id,
    });
    expect(
      (
        await call('POST', '/contracts', 'q-manager', {
          quoteId: q.id,
          startDate: '2026-05-02',
          endDate: '2026-05-01',
        })
      ).status,
    ).toBe(400);

    const id = c.body.id;
    expect((await call('POST', `/contracts/${id}/complete`, 'q-manager')).status).toBe(409); // not active yet
    const active = await call('POST', `/contracts/${id}/activate`, 'q-manager');
    expect(active.body.status).toBe('ACTIVE');
    expect(active.body.signedAt).toBeTruthy();
    expect((await call('POST', `/contracts/${id}/activate`, 'q-manager')).status).toBe(409);
    const upd = await call('PATCH', `/contracts/${id}`, 'q-manager', { terms: 'شرایط جدید' });
    expect(upd.body.terms).toBe('شرایط جدید');
    const done = await call('POST', `/contracts/${id}/complete`, 'q-manager');
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.closedAt).toBeTruthy();
    expect((await call('PATCH', `/contracts/${id}`, 'q-manager', { title: 'بسته' })).status).toBe(
      409,
    );
    expect((await call('POST', `/contracts/${id}/terminate`, 'q-manager')).status).toBe(409);
    const list = await call('GET', `/contracts?customerId=${customerId}`, 'q-sales');
    expect(list.body.items.map((x: any) => x.id)).toContain(id);
  });

  it('deletes only draft quotes, and only with the delete permission', async () => {
    const q = await newQuote();
    expect((await call('DELETE', `/quotes/${q.id}`, 'q-sales')).status).toBe(403);
    expect((await call('DELETE', `/quotes/${q.id}`, 'q-manager')).status).toBe(204);
    expect((await call('GET', `/quotes/${q.id}`, 'q-manager')).status).toBe(404);
  });

  it('writes audit records for sensitive quote and contract actions', async () => {
    for (const action of [
      'product.created',
      'quote.created',
      'quote.sent',
      'quote.accepted',
      'quote.revised',
      'quote.deleted',
      'contract.created',
      'contract.active',
      'contract.completed',
    ]) {
      expect(
        await prisma.auditLog.count({ where: { action, actorId: { in: Object.values(userIds) } } }),
        action,
      ).toBeGreaterThan(0);
    }
  });
});
