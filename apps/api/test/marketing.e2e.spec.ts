import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Lead sources, campaigns and marketing reports against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Marketing-Spec-Passw0rd';

interface Res {
  status: number;
  body: any;
}

describe.skipIf(!run)('campaigns and lead sources (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  const cookies: Record<string, string> = {};
  const userIds: string[] = [];
  const roleOf: Record<string, string> = {
    'm-manager': 'manager',
    'm-sales': 'sales',
    'm-viewer': 'viewer',
  };
  const tag = Date.now().toString(36);
  let sourceId = '';
  let campaignId = '';
  let leadId = '';

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
    // These specs are about other features: let the sales role see the whole organization (row access has its own spec).
    await prisma.role.updateMany({ where: { key: 'sales' }, data: { dataScope: 'ALL' } });
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
      await prisma.deal.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.lead.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.contact.deleteMany({ where: { customer: { createdById: { in: userIds } } } });
      await prisma.customer.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.campaign.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.leadSource.deleteMany({ where: { name: { contains: tag } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('requires authentication and the right permission on every endpoint', async () => {
    for (const [m, u] of [
      ['GET', '/lead-sources'],
      ['GET', '/campaigns'],
      ['GET', '/reports/campaigns'],
      ['GET', '/reports/lead-sources'],
    ] as const) {
      expect((await call(m, u, null)).status).toBe(401);
    }
    // sales may read campaigns but not manage them or read org-wide reports
    expect((await call('GET', '/campaigns', 'm-sales')).status).toBe(200);
    expect((await call('POST', '/campaigns', 'm-sales', { name: 'کمپین من' })).status).toBe(403);
    expect((await call('POST', '/lead-sources', 'm-sales', { name: `منبع ${tag}` })).status).toBe(
      403,
    );
    expect((await call('GET', '/reports/campaigns', 'm-sales')).status).toBe(403);
    expect((await call('GET', '/reports/lead-sources', 'm-viewer')).status).toBe(403);
    expect((await call('POST', '/campaigns', 'm-viewer', { name: 'کمپین من' })).status).toBe(403);
    expect((await call('GET', '/lead-sources', 'm-viewer')).status).toBe(200);
  });

  it('manages lead sources: unique names, deactivation, no unknown fields', async () => {
    const res = await call('POST', '/lead-sources', 'm-manager', { name: `منبع ${tag}` });
    expect(res.status).toBe(201);
    sourceId = res.body.id;
    expect((await call('POST', '/lead-sources', 'm-manager', { name: `منبع ${tag}` })).status).toBe(
      409,
    );
    expect(
      (await call('POST', '/lead-sources', 'm-manager', { name: `منبع ۲ ${tag}`, x: 1 })).status,
    ).toBe(400);
    const list = await call('GET', '/lead-sources', 'm-sales');
    expect(list.body.map((s: any) => s.id)).toContain(sourceId);
  });

  it('creates campaigns with validation and partial updates that keep other fields', async () => {
    expect(
      (
        await call('POST', '/campaigns', 'm-manager', {
          name: `کمپین ${tag}`,
          startDate: '2026-10-10',
          endDate: '2026-10-01',
        })
      ).status,
    ).toBe(400);
    expect((await call('POST', '/campaigns', 'm-manager', { name: 'x' })).status).toBe(400);
    expect(
      (await call('POST', '/campaigns', 'm-manager', { name: `کمپین ${tag}`, budget: '-5' }))
        .status,
    ).toBe(400);
    const res = await call('POST', '/campaigns', 'm-manager', {
      name: `کمپین ${tag}`,
      channel: 'ایمیل',
      status: 'ACTIVE',
      budget: '1000000',
      startDate: '2026-10-01',
    });
    expect(res.status).toBe(201);
    campaignId = res.body.id;
    expect(res.body.budget).toBe('1000000');
    expect(res.body.leadCount).toBe(0);
    // a status-only update must not reset the budget or channel
    const upd = await call('PATCH', `/campaigns/${campaignId}`, 'm-manager', {
      status: 'COMPLETED',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe('COMPLETED');
    expect(upd.body.budget).toBe('1000000');
    expect(upd.body.channel).toBe('ایمیل');
    // end before the stored start is rejected on update too
    expect(
      (await call('PATCH', `/campaigns/${campaignId}`, 'm-manager', { endDate: '2026-09-01' }))
        .status,
    ).toBe(400);
    const found = await call('GET', `/campaigns?q=${encodeURIComponent(tag)}`, 'm-sales');
    expect(found.body.items.map((c: any) => c.id)).toContain(campaignId);
  });

  it('attributes leads to a source and campaign, rejecting foreign or inactive references', async () => {
    const stranger = '018f0000-0000-7000-8000-000000000000';
    expect(
      (await call('POST', '/leads', 'm-sales', { name: 'سرنخ بد', campaignId: stranger })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/leads', 'm-sales', { name: 'سرنخ بد', sourceId: stranger })).status,
    ).toBe(400);
    const res = await call('POST', '/leads', 'm-sales', {
      name: `سرنخ کمپین ${tag}`,
      sourceId,
      campaignId,
    });
    expect(res.status).toBe(201);
    leadId = res.body.id;
    expect(res.body.source).toEqual({ id: sourceId, name: `منبع ${tag}` });
    expect(res.body.campaign).toEqual({ id: campaignId, name: `کمپین ${tag}` });
    // the source name is searchable
    const byName = await call('GET', `/leads?q=${encodeURIComponent(`منبع ${tag}`)}`, 'm-sales');
    expect(byName.body.items.map((l: any) => l.id)).toContain(leadId);
    const byCampaign = await call('GET', `/leads?campaignId=${campaignId}`, 'm-sales');
    expect(byCampaign.body.items).toHaveLength(1);
    // a deactivated source can no longer be assigned
    await call('PATCH', `/lead-sources/${sourceId}`, 'm-manager', { active: false });
    expect((await call('POST', '/leads', 'm-sales', { name: 'سرنخ بد', sourceId })).status).toBe(
      400,
    );
    await call('PATCH', `/lead-sources/${sourceId}`, 'm-manager', { active: true });
  });

  it('reports campaign ROI from won deals and lead-source conversion', async () => {
    const before = await call('GET', '/reports/campaigns', 'm-manager');
    const row0 = before.body.find((r: any) => r.campaignId === campaignId);
    expect(row0).toMatchObject({
      leads: 1,
      converted: 0,
      wonDeals: 0,
      wonAmount: '0',
      roiBp: -10000,
    });
    expect(row0.costPerLead).toBe('1000000');

    const conv = await call('POST', `/leads/${leadId}/convert`, 'm-sales', {
      customerKind: 'ORGANIZATION',
      deal: { title: `فرصت ${tag}`, amount: '5000000' },
    });
    expect(conv.status).toBe(200);
    // an open deal does not count as return yet
    const open = (await call('GET', '/reports/campaigns', 'm-manager')).body.find(
      (r: any) => r.campaignId === campaignId,
    );
    expect(open).toMatchObject({ converted: 1, wonDeals: 0, wonAmount: '0' });

    const won = await prisma.pipelineStage.findFirstOrThrow({ where: { kind: 'WON' } });
    await prisma.deal.update({ where: { id: conv.body.dealId }, data: { stageId: won.id } });
    const after = (await call('GET', '/reports/campaigns', 'm-manager')).body.find(
      (r: any) => r.campaignId === campaignId,
    );
    expect(after).toMatchObject({
      leads: 1,
      converted: 1,
      wonDeals: 1,
      wonAmount: '5000000',
      budget: '1000000',
      roiBp: 40000,
    });

    const sources = await call('GET', '/reports/lead-sources', 'm-manager');
    expect(sources.status).toBe(200);
    expect(sources.body.find((r: any) => r.sourceId === sourceId)).toMatchObject({
      name: `منبع ${tag}`,
      leads: 1,
      converted: 1,
      conversionBp: 10000,
    });
  });

  it('soft-deletes a campaign (only with the delete permission) and hides it from reports', async () => {
    expect((await call('DELETE', `/campaigns/${campaignId}`, 'm-sales')).status).toBe(403);
    expect((await call('DELETE', `/campaigns/${campaignId}`, 'm-manager')).status).toBe(204);
    expect((await call('GET', `/campaigns/${campaignId}`, 'm-manager')).status).toBe(404);
    const rows = (await call('GET', '/reports/campaigns', 'm-manager')).body;
    expect(rows.find((r: any) => r.campaignId === campaignId)).toBeUndefined();
  });
});
