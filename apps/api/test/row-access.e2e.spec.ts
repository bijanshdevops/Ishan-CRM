import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Row-level access (ADR 0017): who sees and changes which records. Real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'RowAccess-Spec-Passw0rd';

interface Res {
  status: number;
  body: any;
}

describe.skipIf(!run)('row-level access (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roleIds: string[] = [];
  let teamId = '';

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    who: string,
    body?: unknown,
  ): Promise<Res> {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { cookie: cookies[who]!, ...(method !== 'GET' ? { origin: ORIGIN } : {}) },
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

  beforeAll(async () => {
    applyTestEnv();
    const { createApp } = await import('../src/bootstrap');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { PasswordService } = await import('../src/modules/auth/password.service');
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    await prisma.role.updateMany({ where: { key: 'sales' }, data: { dataScope: 'TEAM' } });
    const hash = await app.get(PasswordService).hash(PASSWORD);
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    const salesRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: org.id, key: 'sales' },
    });
    const role = (key: string) =>
      prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key } });
    const ownRole = await prisma.role.create({
      data: {
        organizationId: org.id,
        key: 'ra-own',
        name: 'ra-own',
        permissions: salesRole.permissions,
        dataScope: 'OWN',
      },
    });
    roleIds.push(ownRole.id);

    const users: Array<[string, string]> = [
      ['ra-admin', (await role('admin')).id],
      ['ra-a', salesRole.id], // TEAM, in the team
      ['ra-b', salesRole.id], // TEAM, in the same team
      ['ra-c', salesRole.id], // TEAM, no team
      ['ra-own', ownRole.id], // OWN, in the team
    ];
    for (const [name, roleId] of users) {
      const email = `${name}@example.com`;
      const user = await prisma.user.create({
        data: { organizationId: org.id, roleId, email, name, passwordHash: hash },
      });
      ids[name] = user.id;
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
    const team = await prisma.team.create({ data: { organizationId: org.id, name: 'ra-team' } });
    teamId = team.id;
    await prisma.teamMember.createMany({
      data: ['ra-a', 'ra-b', 'ra-own'].map((n) => ({ teamId, userId: ids[n] })),
    });
  });

  afterAll(async () => {
    if (prisma) {
      const userIds = Object.values(ids);
      await prisma.activity.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.campaign.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.deal.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.lead.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.customer.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    }
    await app?.close();
  });

  const code = (r: Res) => r.body?.code ?? r.body?.error?.code;
  let customerA = '';
  let leadA = '';
  let dealA = '';
  let campaignA = '';
  let noteA = '';

  it('creates records owned by the creator', async () => {
    const c = await call('POST', '/customers', 'ra-a', { kind: 'PERSON', name: 'مشتری الف' });
    expect(c.status).toBe(201);
    customerA = c.body.id;
    expect(c.body.owner?.id ?? c.body.ownerId).toBe(ids['ra-a']);
    leadA = (await call('POST', '/leads', 'ra-a', { name: 'سرنخ الف' })).body.id;
    dealA = (
      await call('POST', '/deals', 'ra-a', {
        title: 'فرصت الف',
        customerId: customerA,
        amount: '1000',
      })
    ).body.id;
    campaignA = (await call('POST', '/campaigns', 'ra-admin', { name: 'کمپین الف' })).body.id;
    // Sales cannot write campaigns, so the admin creates it and hands it to ra-a.
    expect(
      (await call('PATCH', `/campaigns/${campaignA}`, 'ra-admin', { ownerId: ids['ra-a'] })).status,
    ).toBe(200);
    noteA = (
      await call('POST', '/activities', 'ra-a', { type: 'NOTE', description: 'یادداشت الف' })
    ).body.id;
    for (const id of [customerA, leadA, dealA, campaignA, noteA]) expect(id).toBeTruthy();
  });

  const resources = (): Array<[string, () => string]> => [
    ['customers', () => customerA],
    ['leads', () => leadA],
    ['deals', () => dealA],
    ['campaigns', () => campaignA],
    ['activities', () => noteA],
  ];

  it('TEAM: a teammate sees and finds the record; an outsider gets 404 everywhere', async () => {
    for (const [path, id] of resources()) {
      expect((await call('GET', `/${path}/${id()}`, 'ra-b')).status, `${path} teammate`).toBe(200);
      expect((await call('GET', `/${path}/${id()}`, 'ra-c')).status, `${path} outsider`).toBe(404);
      const list = await call('GET', `/${path}?limit=100`, 'ra-c');
      expect(list.status).toBe(200);
      expect(
        list.body.items.some((i: any) => i.id === id()),
        `${path} list leak`,
      ).toBe(false);
    }
    expect(
      (await call('GET', `/search?q=${encodeURIComponent('مشتری')}`, 'ra-c')).body
        .customers,
    ).toEqual([]);
  });

  it('OWN: a teammate with an own-only role sees nothing of the others', async () => {
    for (const [path, id] of resources()) {
      expect((await call('GET', `/${path}/${id()}`, 'ra-own')).status, path).toBe(404);
    }
  });

  it('ALL: admin sees every record', async () => {
    for (const [path, id] of resources()) {
      expect((await call('GET', `/${path}/${id()}`, 'ra-admin')).status, path).toBe(200);
    }
  });

  it('writes outside the scope look like missing records', async () => {
    expect((await call('PATCH', `/customers/${customerA}`, 'ra-c', { name: 'تغییر' })).status).toBe(
      404,
    );
    expect((await call('PATCH', `/leads/${leadA}`, 'ra-c', { name: 'تغییر' })).status).toBe(404);
    expect((await call('PATCH', `/deals/${dealA}`, 'ra-c', { title: 'تغییر' })).status).toBe(404);
    expect((await call('GET', `/customers/${customerA}/contacts`, 'ra-c')).status).toBe(404);
    expect((await call('GET', `/customers/${customerA}/timeline`, 'ra-c')).status).toBe(404);
  });

  it('cannot attach new records to a customer outside the scope', async () => {
    const deal = await call('POST', '/deals', 'ra-c', {
      title: 'ورود غیرمجاز',
      customerId: customerA,
      amount: '1',
    });
    expect(deal.status).toBe(400);
    const act = await call('POST', '/activities', 'ra-c', {
      type: 'NOTE',
      description: 'ورود غیرمجاز',
      customerId: customerA,
    });
    expect(act.status).toBe(400);
  });

  it('assigns only inside the actor scope', async () => {
    const toMate = await call('PATCH', `/customers/${customerA}`, 'ra-a', { ownerId: ids['ra-b'] });
    expect(toMate.status).toBe(200);
    const out = await call('PATCH', `/customers/${customerA}`, 'ra-b', { ownerId: ids['ra-c'] });
    expect(out.status).toBe(403);
    expect(code(out)).toBe('owner_out_of_scope');
    const created = await call('POST', '/customers', 'ra-b', {
      kind: 'PERSON',
      name: 'برای بیرونی',
      ownerId: ids['ra-c'],
    });
    expect(created.status).toBe(403);
    // Admin (ALL) may assign to anyone.
    const byAdmin = await call('PATCH', `/customers/${customerA}`, 'ra-admin', {
      ownerId: ids['ra-c'],
    });
    expect(byAdmin.status).toBe(200);
    // Now the record left the first team: ra-a can no longer see it, ra-c can.
    expect((await call('GET', `/customers/${customerA}`, 'ra-a')).status).toBe(404);
    expect((await call('GET', `/customers/${customerA}`, 'ra-c')).status).toBe(200);
  });

  it('dashboard and reports count only visible records', async () => {
    const own = await call('GET', '/dashboard?scope=me', 'ra-c');
    const a = await call('GET', '/dashboard?scope=me', 'ra-b');
    expect(own.status).toBe(200);
    expect(a.status).toBe(200);
    const leadsOf = (r: Res) =>
      Object.values(r.body.leads?.byStatus ?? {}).reduce((n: number, c: any) => n + Number(c), 0);
    expect(leadsOf(own)).toBe(0);
  });

  it('roles: data scope is editable on system roles except admin', async () => {
    const roles = await call('GET', '/roles', 'ra-admin');
    expect(roles.status).toBe(200);
    const admin = roles.body.find((r: any) => r.key === 'admin');
    const viewer = roles.body.find((r: any) => r.key === 'viewer');
    expect(admin.dataScope).toBe('ALL');
    const lock = await call('PATCH', `/roles/${admin.id}`, 'ra-admin', { dataScope: 'OWN' });
    expect(lock.status).toBe(400);
    expect(code(lock)).toBe('ADMIN_SCOPE_LOCKED');
    const rename = await call('PATCH', `/roles/${viewer.id}`, 'ra-admin', { name: 'xx' });
    expect(code(rename)).toBe('SYSTEM_ROLE_IMMUTABLE');
    const ok = await call('PATCH', `/roles/${viewer.id}`, 'ra-admin', { dataScope: 'TEAM' });
    expect(ok.status).toBe(200);
    expect(ok.body.dataScope).toBe('TEAM');
    await call('PATCH', `/roles/${viewer.id}`, 'ra-admin', { dataScope: 'ALL' });
  });

  it('the database refuses a restricted admin role', async () => {
    await expect(
      prisma.role.updateMany({ where: { key: 'admin' }, data: { dataScope: 'OWN' } }),
    ).rejects.toThrow();
  });
});
