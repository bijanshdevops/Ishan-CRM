import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Dashboard and reports against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Reports-Spec-Passw0rd';
const DAY = 24 * 60 * 60_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

interface Res {
  status: number;
  body: any;
  headers: Record<string, any>;
  text: string;
}

describe.skipIf(!run)('dashboard and reports (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let roleId = '';
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'rep-a': 'sales',
    'rep-b': 'sales',
    'rep-manager': 'manager',
    'rep-viewer': 'viewer',
  };

  async function call(
    url: string,
    who: string | null,
    method: 'GET' | 'POST' = 'GET',
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
    return { status: res.statusCode, body: parsed, headers: res.headers, text: res.body };
  }

  async function login(name: string) {
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
    const mk = async (name: string, rid: string, display = name) => {
      const user = await prisma.user.create({
        data: {
          organizationId: org.id,
          roleId: rid,
          email: `${name}@example.com`,
          name: display,
          passwordHash: hash,
        },
      });
      userIds[name] = user.id;
      await login(name);
    };
    for (const [name, key] of Object.entries(roleOf)) {
      const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key } });
      // A display name that starts with "=" proves CSV formula neutralization.
      await mk(name, role.id, name === 'rep-b' ? '=rep-b-formula' : name);
    }
    const limited = await prisma.role.create({
      data: {
        organizationId: org.id,
        key: 'spec-reports-limited',
        name: 'spec limited',
        permissions: ['customers.read'],
      },
    });
    roleId = limited.id;
    await mk('rep-limited', limited.id);
  });

  afterAll(async () => {
    if (prisma) {
      const ids = Object.values(userIds);
      await prisma.activity.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.deal.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.customer.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      if (roleId) await prisma.role.delete({ where: { id: roleId } });
    }
    await app?.close();
  });

  let stages: any[] = [];
  const customer: Record<string, string> = {};

  it('requires authentication and the right permissions', async () => {
    expect((await call('/dashboard', null)).status).toBe(401);
    expect((await call('/reports/sales-performance', null)).status).toBe(401);
    expect((await call('/dashboard', 'rep-viewer')).status).toBe(200);
    // organization-wide numbers and reports need reports.read
    expect((await call('/dashboard?scope=all', 'rep-viewer')).status).toBe(403);
    expect((await call('/dashboard?scope=all', 'rep-a')).status).toBe(403);
    expect((await call('/reports/sales-performance', 'rep-a')).status).toBe(403);
    expect((await call('/reports/sales-performance.csv', 'rep-viewer')).status).toBe(403);
    expect((await call('/dashboard?scope=all', 'rep-manager')).status).toBe(200);
    expect((await call('/reports/sales-performance', 'rep-manager')).status).toBe(200);
  });

  it('only returns the sections the viewer may read', async () => {
    const res = await call('/dashboard', 'rep-limited');
    expect(res.status).toBe(200);
    expect(res.body.customers).not.toBeNull();
    expect(res.body.leads).toBeNull();
    expect(res.body.deals).toBeNull();
    expect(res.body.activities).toBeNull();
  });

  it('validates the date range', async () => {
    const from = encodeURIComponent(iso(0));
    const before = encodeURIComponent(iso(-DAY));
    expect((await call(`/dashboard?from=${from}&to=${before}`, 'rep-a')).status).toBe(400);
    const long = encodeURIComponent(iso(-401 * DAY));
    expect((await call(`/dashboard?from=${long}&to=${from}`, 'rep-a')).status).toBe(400);
    expect((await call('/dashboard?scope=everyone', 'rep-a')).status).toBe(400);
    expect((await call('/dashboard?from=yesterday', 'rep-a')).status).toBe(400);
    expect((await call('/reports/sales-performance?from=x', 'rep-manager')).status).toBe(400);
  });

  it('prepares sales data for two reps', async () => {
    stages = (await call('/pipeline/stages', 'rep-a')).body;
    const open = stages.find((s) => s.kind === 'OPEN');
    const won = stages.find((s) => s.kind === 'WON');
    const lost = stages.find((s) => s.kind === 'LOST');
    for (const who of ['rep-a', 'rep-b']) {
      const c = await call('/customers', who, 'POST', { kind: 'PERSON', name: `مشتری ${who}` });
      expect(c.status).toBe(201);
      customer[who] = c.body.id;
    }
    // rep-a: one open deal and one won deal
    await call('/deals', 'rep-a', 'POST', {
      title: 'باز الف',
      customerId: customer['rep-a'],
      stageId: open.id,
      amount: '1000000000',
    });
    const dWon = await call('/deals', 'rep-a', 'POST', {
      title: 'برده الف',
      customerId: customer['rep-a'],
      amount: '2500000000',
    });
    expect(
      (await call(`/deals/${dWon.body.id}/move`, 'rep-a', 'POST', { stageId: won.id })).status,
    ).toBe(200);
    // rep-b: one lost deal
    const dLost = await call('/deals', 'rep-b', 'POST', {
      title: 'باخته ب',
      customerId: customer['rep-b'],
      amount: '700000000',
    });
    expect(
      (
        await call(`/deals/${dLost.body.id}/move`, 'rep-b', 'POST', {
          stageId: lost.id,
          lostReason: 'قیمت',
        })
      ).status,
    ).toBe(200);
    // activities for rep-a: one finished call, one overdue task
    expect(
      (
        await call('/activities', 'rep-a', 'POST', {
          type: 'CALL',
          title: 'تماس',
          status: 'DONE',
          completedAt: iso(-60_000),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call('/activities', 'rep-a', 'POST', {
          type: 'TASK',
          title: 'عقب',
          dueAt: iso(-3600_000),
        })
      ).status,
    ).toBe(201);
    // a lead for rep-a
    expect((await call('/leads', 'rep-a', 'POST', { name: 'سرنخ داشبورد' })).status).toBe(201);
  });

  it("computes a rep's own dashboard exactly", async () => {
    const open = stages.find((s) => s.kind === 'OPEN');
    const res = await call('/dashboard', 'rep-a');
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.scope).toBe('me');
    expect(d.customers).toEqual({ total: 1, created: 1 });
    expect(d.leads.open).toBe(1);
    expect(d.leads.created).toBe(1);
    expect(d.leads.byStatus.NEW).toBe(1);
    expect(d.deals.openCount).toBe(1);
    expect(d.deals.openAmount).toBe('1000000000');
    expect(d.deals.weightedAmount).toBe(
      ((1000000000n * BigInt(open.probability)) / 100n).toString(),
    );
    expect(d.deals.wonCount).toBe(1);
    expect(d.deals.wonAmount).toBe('2500000000');
    expect(d.deals.lostCount).toBe(0);
    expect(d.deals.winRate).toBe(100);
    expect(d.deals.byStage).toHaveLength(stages.length);
    expect(d.deals.wonByDay).toHaveLength(1);
    expect(d.deals.wonByDay[0].amount).toBe('2500000000');
    expect(d.deals.wonByDay[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.activities.overdue).toBe(1);
    expect(d.activities.doneInRange).toBe(1);
    expect(d.activities.byType.CALL).toBe(1);

    const b = (await call('/dashboard', 'rep-b')).body;
    expect(b.deals.wonCount).toBe(0);
    expect(b.deals.lostCount).toBe(1);
    expect(b.deals.winRate).toBe(0);
    expect(b.deals.openCount).toBe(0);
  });

  it('honors the date range: closed work is range-bound, open pipeline is a snapshot', async () => {
    const from = encodeURIComponent(iso(DAY));
    const to = encodeURIComponent(iso(2 * DAY));
    const d = (await call(`/dashboard?from=${from}&to=${to}`, 'rep-a')).body;
    expect(d.deals.wonCount).toBe(0);
    expect(d.deals.winRate).toBeNull();
    expect(d.deals.wonByDay).toEqual([]);
    expect(d.deals.openCount).toBe(1);
    expect(d.activities.doneInRange).toBe(0);
    expect(d.customers.created).toBe(0);
    expect(d.customers.total).toBe(1);
  });

  it('organization scope covers everyone and the sales report breaks it down', async () => {
    const all = (await call('/dashboard?scope=all', 'rep-manager')).body;
    expect(BigInt(all.deals.wonAmount) >= 2500000000n).toBe(true);
    expect(all.deals.lostCount >= 1).toBe(true);

    const report = await call('/reports/sales-performance', 'rep-manager');
    expect(report.status).toBe(200);
    const a = report.body.rows.find((r: any) => r.ownerId === userIds['rep-a']);
    const b = report.body.rows.find((r: any) => r.ownerId === userIds['rep-b']);
    expect(a).toMatchObject({
      ownerName: 'rep-a',
      wonCount: 1,
      wonAmount: '2500000000',
      lostCount: 0,
      openCount: 1,
      openAmount: '1000000000',
      activitiesDone: 1,
    });
    expect(b).toMatchObject({ lostCount: 1, wonCount: 0, wonAmount: '0' });
    const won = report.body.rows.map((r: any) => BigInt(r.wonAmount));
    expect(won).toEqual([...won].sort((x, y) => (x > y ? -1 : x < y ? 1 : 0)));
  });

  it('exports the report as CSV, neutralizes formulas and audits the export', async () => {
    const res = await call('/reports/sales-performance.csv', 'rep-manager');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toContain('sales-performance.csv');
    expect(res.text.startsWith('﻿')).toBe(true);
    expect(res.text).toContain('rep-a');
    expect(res.text).toContain("'=rep-b-formula");
    expect(res.text.split(/\r\n/).some((line) => line.startsWith('='))).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'report.exported' } })).toBeGreaterThan(
      0,
    );
  });
});
