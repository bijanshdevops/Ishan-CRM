import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Leads, pipeline and deals against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Sales-Spec-Passw0rd';

interface Res {
  status: number;
  body: any;
  headers: Record<string, any>;
}

describe.skipIf(!run)('sales (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  const cookies: Record<string, string> = {};
  const userIds: string[] = [];
  const roleOf: Record<string, string> = {
    'sales-admin': 'admin',
    'sales-manager': 'manager',
    'sales-rep': 'sales',
    'sales-viewer': 'viewer',
  };

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
    for (const [name, key] of Object.entries(roleOf)) {
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: org.id, key },
      });
      const user = await prisma.user.create({
        data: {
          organizationId: org.id,
          roleId: role.id,
          email: `${name}@example.com`,
          name,
          passwordHash: hash,
        },
      });
      userIds.push(user.id);
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

  afterAll(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.deal.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.lead.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.contact.deleteMany({ where: { customer: { createdById: { in: userIds } } } });
      await prisma.customer.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.pipelineStage.deleteMany({ where: { name: { startsWith: 'spec-' } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  let stages: any[] = [];
  let leadId = '';
  let customerId = '';
  let dealId = '';

  it('enforces authentication and permissions', async () => {
    expect((await call('GET', '/leads', null)).status).toBe(401);
    expect((await call('GET', '/leads', 'sales-viewer')).status).toBe(200);
    expect((await call('POST', '/leads', 'sales-viewer', { name: 'سرنخ تست' })).status).toBe(403);
    expect((await call('GET', '/deals/funnel', 'sales-viewer')).status).toBe(200);
    expect((await call('POST', '/pipeline/stages', 'sales-rep', { name: 'spec-x' })).status).toBe(
      403,
    );
    expect((await call('POST', '/deals', 'sales-viewer', {})).status).toBe(403);
  });

  it('serves the seeded default pipeline', async () => {
    const res = await call('GET', '/pipeline/stages', 'sales-rep');
    expect(res.status).toBe(200);
    stages = res.body;
    expect(stages.length).toBeGreaterThanOrEqual(3);
    expect(stages.some((s: any) => s.kind === 'WON')).toBe(true);
    expect(stages.some((s: any) => s.kind === 'LOST')).toBe(true);
    expect(stages[0].kind).toBe('OPEN');
  });

  it('creates, searches and updates leads', async () => {
    expect((await call('POST', '/leads', 'sales-rep', { name: 'x' })).status).toBe(400);
    const res = await call('POST', '/leads', 'sales-rep', {
      name: 'مریم صالحی',
      company: 'شرکت بتا',
      email: 'maryam@example.com',
      phone: '۰۹۱۲۷۷۷۷۷۷۷',
      source: 'وب‌سایت',
    });
    expect(res.status).toBe(201);
    leadId = res.body.id;
    expect(res.body.status).toBe('NEW');
    expect(res.body.phone).toBe('09127777777');
    const created = await prisma.domainEvent.findMany({
      where: { type: 'lead.created', entityId: res.body.id },
    });
    expect(created).toHaveLength(1);
    expect(created[0].payload.name).toBe('مریم صالحی');
    const found = await call('GET', `/leads?q=${encodeURIComponent('صالحي')}`, 'sales-viewer');
    expect(found.body.items.map((l: any) => l.id)).toContain(leadId);
    const upd = await call('PATCH', `/leads/${leadId}`, 'sales-rep', { status: 'QUALIFIED' });
    expect(upd.body.status).toBe('QUALIFIED');
  });

  it('converts a lead into a customer, contact and deal atomically', async () => {
    expect(
      (
        await call('POST', `/leads/${leadId}/convert`, 'sales-viewer', {
          customerKind: 'ORGANIZATION',
        })
      ).status,
    ).toBe(403);
    const res = await call('POST', `/leads/${leadId}/convert`, 'sales-rep', {
      customerKind: 'ORGANIZATION',
      deal: { title: 'قرارداد بتا', amount: '5000000000' },
    });
    expect(res.status).toBe(200);
    customerId = res.body.customerId;
    dealId = res.body.dealId;
    const cust = await call('GET', `/customers/${customerId}`, 'sales-rep');
    expect(cust.body.name).toBe('شرکت بتا');
    expect(cust.body.contacts).toHaveLength(1);
    const lead = await call('GET', `/leads/${leadId}`, 'sales-rep');
    expect(lead.body.status).toBe('CONVERTED');
    expect(lead.body.convertedDealId).toBe(dealId);
    const convertedEvents = await prisma.domainEvent.findMany({
      where: { type: 'lead.converted', entityId: leadId },
    });
    expect(convertedEvents).toHaveLength(1);
    expect(convertedEvents[0].payload).toMatchObject({ customerId, dealId, amount: '5000000000' });
    const deal = await call('GET', `/deals/${dealId}`, 'sales-rep');
    expect(deal.body.amount).toBe('5000000000');
    expect(deal.body.stage.id).toBe(stages[0].id);
    expect(deal.body.contact).not.toBeNull();
    // cannot convert twice or edit afterwards
    expect((await call('POST', `/leads/${leadId}/convert`, 'sales-rep', {})).status).toBe(400);
    expect(
      (await call('PATCH', `/leads/${leadId}`, 'sales-rep', { name: 'نام جدید' })).status,
    ).toBe(400);
  });

  it('does not convert disqualified leads', async () => {
    const l = await call('POST', '/leads', 'sales-rep', { name: 'سرنخ رد شده' });
    await call('PATCH', `/leads/${l.body.id}`, 'sales-rep', {
      status: 'DISQUALIFIED',
      disqualifyReason: 'بودجه ندارد',
    });
    expect((await call('POST', `/leads/${l.body.id}/convert`, 'sales-rep', {})).status).toBe(400);
  });

  it('validates deal references and money', async () => {
    const base = { title: 'فرصت تست', customerId };
    expect((await call('POST', '/deals', 'sales-rep', { ...base, amount: '-5' })).status).toBe(400);
    expect((await call('POST', '/deals', 'sales-rep', { ...base, amount: '12.5' })).status).toBe(
      400,
    );
    expect(
      (
        await call('POST', '/deals', 'sales-rep', {
          ...base,
          customerId: '0197c0de-0000-7000-8000-000000000000',
        })
      ).status,
    ).toBe(400);
    const wonStage = stages.find((s) => s.kind === 'WON');
    expect(
      (await call('POST', '/deals', 'sales-rep', { ...base, stageId: wonStage.id })).status,
    ).toBe(400);
    const ok = await call('POST', '/deals', 'sales-rep', {
      ...base,
      amount: '1000000000',
      expectedCloseDate: '2026-12-01',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.expectedCloseDate).toBe('2026-12-01');
    expect(ok.body.owner.name).toBe('sales-rep');
  });

  it('moves deals through stages, records close state and the funnel', async () => {
    const won = stages.find((s) => s.kind === 'WON');
    const lost = stages.find((s) => s.kind === 'LOST');
    const before = await call('GET', '/deals/funnel', 'sales-viewer');
    const moved = await call('POST', `/deals/${dealId}/move`, 'sales-rep', {
      stageId: stages[2].id,
    });
    expect(moved.body.stage.id).toBe(stages[2].id);
    expect(moved.body.closedAt).toBeNull();
    const closed = await call('POST', `/deals/${dealId}/move`, 'sales-rep', { stageId: won.id });
    expect(closed.body.closedAt).not.toBeNull();
    const reopened = await call('POST', `/deals/${dealId}/move`, 'sales-rep', {
      stageId: stages[1].id,
    });
    expect(reopened.body.closedAt).toBeNull();
    const lostRes = await call('POST', `/deals/${dealId}/move`, 'sales-rep', {
      stageId: lost.id,
      lostReason: 'قیمت',
    });
    expect(lostRes.body.lostReason).toBe('قیمت');
    expect(
      (
        await call('POST', `/deals/${dealId}/move`, 'sales-rep', {
          stageId: '0197c0de-0000-7000-8000-000000000000',
        })
      ).status,
    ).toBe(400);

    const events = await prisma.dealStageEvent.count({ where: { dealId } });
    expect(events).toBe(5);
    // each of the four moves wrote exactly one outbox event, in the same transaction
    expect(
      await prisma.domainEvent.count({ where: { type: 'deal.stage_changed', entityId: dealId } }),
    ).toBe(4); // the 5th stage row is the initial placement made by the conversion

    await call('POST', `/deals/${dealId}/move`, 'sales-rep', { stageId: won.id });
    const after = await call('GET', '/deals/funnel', 'sales-viewer');
    expect(after.body.totals.wonCount).toBe(before.body.totals.wonCount + 1);
    expect(BigInt(after.body.totals.wonAmount)).toBe(
      BigInt(before.body.totals.wonAmount) + 5000000000n,
    );
  });

  it('lists deals with filters and deletes with permission only', async () => {
    const list = await call('GET', `/deals?customerId=${customerId}`, 'sales-viewer');
    expect(list.body.items.length).toBe(2);
    const q = await call('GET', `/deals?q=${encodeURIComponent('قرارداد')}`, 'sales-viewer');
    expect(q.body.items.map((d: any) => d.id)).toContain(dealId);
    expect((await call('DELETE', `/deals/${dealId}`, 'sales-rep')).status).toBe(403);
    expect((await call('DELETE', `/deals/${dealId}`, 'sales-manager')).status).toBe(204);
    expect((await call('GET', `/deals/${dealId}`, 'sales-viewer')).status).toBe(404);
  });

  it('manages pipeline stages with guards', async () => {
    const created = await call('POST', '/pipeline/stages', 'sales-manager', {
      name: 'spec-demo',
      probability: 60,
    });
    expect(created.status).toBe(201);
    expect(
      (await call('POST', '/pipeline/stages', 'sales-manager', { name: 'spec-demo' })).status,
    ).toBe(409);
    const all = (await call('GET', '/pipeline/stages', 'sales-manager')).body.map((s: any) => s.id);
    expect(
      (await call('PUT', '/pipeline/stages/order', 'sales-manager', { stageIds: all.slice(1) }))
        .status,
    ).toBe(400);
    const reordered = [created.body.id, ...all.filter((i: string) => i !== created.body.id)];
    const ro = await call('PUT', '/pipeline/stages/order', 'sales-manager', {
      stageIds: reordered,
    });
    expect(ro.body[0].id).toBe(created.body.id);
    // restore order, then delete the unused stage
    await call('PUT', '/pipeline/stages/order', 'sales-manager', { stageIds: all });
    expect(
      (await call('DELETE', `/pipeline/stages/${created.body.id}`, 'sales-manager')).status,
    ).toBe(204);
    // a stage that still holds deals cannot be removed
    const d = await call('POST', '/deals', 'sales-rep', {
      title: 'فرصت مرحله',
      customerId,
      stageId: stages[3].id,
    });
    expect(d.status).toBe(201);
    expect((await call('DELETE', `/pipeline/stages/${stages[3].id}`, 'sales-manager')).status).toBe(
      409,
    );
  });

  it('guards concurrent edits of leads and deals with If-Match, atomically', async () => {
    const lead = await call('POST', '/leads', 'sales-rep', { name: 'سرنخ همزمانی' });
    expect(lead.status).toBe(201);
    expect(lead.body.updatedAt).toBeTruthy();
    const leadTag = (await call('GET', `/leads/${lead.body.id}`, 'sales-rep')).headers.etag;
    expect(leadTag).toMatch(/^"\d+"$/);
    await new Promise((r) => setTimeout(r, 5));
    const bump = await call('PATCH', `/leads/${lead.body.id}`, 'sales-manager', { company: 'الف' });
    expect(bump.status).toBe(200);
    const staleLead = await call(
      'PATCH',
      `/leads/${lead.body.id}`,
      'sales-rep',
      { company: 'ب' },
      { 'if-match': leadTag },
    );
    expect(staleLead.status).toBe(412);
    expect(staleLead.body.error.code).toBe('STALE_ENTITY');

    const deal = await call('POST', '/deals', 'sales-rep', { title: 'فرصت همزمانی', customerId });
    expect(deal.status).toBe(201);
    const dealTag = (await call('GET', `/deals/${deal.body.id}`, 'sales-rep')).headers.etag;
    await new Promise((r) => setTimeout(r, 5));
    expect(
      (await call('PATCH', `/deals/${deal.body.id}`, 'sales-manager', { notes: 'x' })).status,
    ).toBe(200);
    const staleDeal = await call(
      'PATCH',
      `/deals/${deal.body.id}`,
      'sales-rep',
      { notes: 'y' },
      { 'if-match': dealTag },
    );
    expect(staleDeal.status).toBe(412);

    // two writers racing on the SAME tag: exactly one wins, whatever the interleaving
    const fresh = (await call('GET', `/deals/${deal.body.id}`, 'sales-rep')).headers.etag;
    const race = await Promise.all(
      ['a', 'b'].map((n) =>
        call('PATCH', `/deals/${deal.body.id}`, 'sales-rep', { notes: n }, { 'if-match': fresh }),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([200, 412]);
  });
});
