import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Workflow management API against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Wf-Spec-Passw0rd';
const MISSING = '0197c0de-0000-7000-8000-000000000000';

interface Res {
  status: number;
  body: any;
  headers: Record<string, any>;
}

describe.skipIf(!run)('workflows (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let orgId = '';
  let otherOrgId = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'wf-admin': 'admin',
    'wf-manager': 'manager',
    'wf-sales': 'sales',
    'wf-viewer': 'viewer',
  };

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  const definition = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    description: 'برای آزمون',
    triggerType: 'deal.stage_changed',
    conditions: [{ field: 'stageKind', op: 'eq', value: 'WON' }],
    actions: [{ type: 'notify', to: 'owner', title: 'فرصت {{title}} برنده شد' }],
    ...over,
  });

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
    orgId = org.id;
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
      ids[name] = user.id;
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
    otherOrgId = (await prisma.organization.create({ data: { name: 'wf-spec-other-org' } })).id;
  });

  afterAll(async () => {
    if (prisma) {
      const all = Object.values(ids);
      await prisma.workflow.deleteMany({
        where: { OR: [{ createdById: { in: all } }, { organizationId: otherOrgId }] },
      });
      // audit_logs is append-only by design; the rows stay.
      await prisma.user.deleteMany({ where: { id: { in: all } } });
      if (otherOrgId) await prisma.organization.delete({ where: { id: otherOrgId } });
    }
    await app?.close();
  });

  it('requires authentication, and the right permission for every endpoint and role', async () => {
    const endpoints: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]> = [
      ['GET', '/workflows/catalog'],
      ['GET', '/workflows'],
      ['POST', '/workflows', definition('x-unauth')],
      ['GET', `/workflows/${MISSING}`],
      ['PATCH', `/workflows/${MISSING}`, { name: 'نام دیگر' }],
      ['POST', `/workflows/${MISSING}/enable`],
      ['POST', `/workflows/${MISSING}/disable`],
      ['DELETE', `/workflows/${MISSING}`],
      ['GET', `/workflows/${MISSING}/runs`],
    ];
    for (const [m, url, body] of endpoints) {
      expect((await call(m, url, null, body)).status, `${m} ${url} anon`).toBe(401);
      for (const who of ['wf-sales', 'wf-viewer']) {
        expect((await call(m, url, who, body)).status, `${m} ${url} ${who}`).toBe(403);
      }
      for (const who of ['wf-admin', 'wf-manager']) {
        // allowed → business answer (404 for the missing id, 200/201 otherwise), never 401/403
        const s = (await call(m, url, who, body)).status;
        expect([200, 201, 204, 404, 409], `${m} ${url} ${who}`).toContain(s);
      }
    }
    // clean up the workflow the loop above created
    await prisma.workflow.deleteMany({ where: { name: 'x-unauth' } });
  });

  it('serves the catalog from the shared contract', async () => {
    const res = await call('GET', '/workflows/catalog', 'wf-manager');
    expect(res.status).toBe(200);
    const stage = res.body.triggers.find((t: any) => t.type === 'deal.stage_changed');
    expect(stage.fields.map((f: any) => f.name)).toEqual(['stageId', 'stageKind', 'amount']);
    expect(res.body.actions).toEqual(['notify', 'create_task']);
    expect(res.body.limits.maxEnabled).toBe(50);
  });

  let wfId = '';
  it('creates a disabled workflow and audits it', async () => {
    const res = await call('POST', '/workflows', 'wf-manager', definition('پیگیری برنده‌ها'));
    expect(res.status).toBe(201);
    wfId = res.body.id;
    expect(res.body).toMatchObject({
      enabled: false,
      triggerType: 'deal.stage_changed',
      createdById: ids['wf-manager'],
    });
    const audit = await prisma.auditLog.findMany({
      where: { action: 'workflow.created', entityId: wfId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(ids['wf-manager']);
    expect(res.headers.etag).toMatch(/^"\d+"$/);
  });

  it('rejects invalid definitions with 400', async () => {
    const bad = async (over: Record<string, unknown>) =>
      (await call('POST', '/workflows', 'wf-admin', definition('نامعتبر', over))).status;
    expect(await bad({ extra: true })).toBe(400);
    expect(await bad({ triggerType: 'user.deleted' })).toBe(400);
    expect(await bad({ conditions: [{ field: 'title', op: 'eq', value: 'x' }] })).toBe(400);
    expect(await bad({ conditions: [{ field: 'stageKind', op: 'gt', value: 'WON' }] })).toBe(400);
    expect(await bad({ actions: [] })).toBe(400);
    expect(await bad({ actions: [{ type: 'notify', to: 'owner', title: '{{ownerId}}' }] })).toBe(
      400,
    );
    expect(await bad({ actions: [{ type: 'send_email', to: 'owner' }] })).toBe(400);
    expect(await bad({ name: 'a' })).toBe(400);
    expect(await prisma.workflow.count({ where: { name: 'نامعتبر' } })).toBe(0);
  });

  it('keeps names unique among live workflows, case-insensitively', async () => {
    const dup = await call('POST', '/workflows', 'wf-admin', definition('پیگیری برنده‌ها'));
    expect(dup.status).toBe(409);
    expect(dup.body.code ?? dup.body.error?.code).toBe('WORKFLOW_NAME_TAKEN');
    const other = await call('POST', '/workflows', 'wf-admin', definition('WF Case Test'));
    expect(other.status).toBe(201);
    expect((await call('POST', '/workflows', 'wf-admin', definition('wf case test'))).status).toBe(
      409,
    );
    expect(
      (await call('PATCH', `/workflows/${other.body.id}`, 'wf-admin', { name: 'پیگیری برنده‌ها' }))
        .status,
    ).toBe(409);
    expect((await call('DELETE', `/workflows/${other.body.id}`, 'wf-admin')).status).toBe(204);
    // a deleted workflow frees its name
    expect((await call('POST', '/workflows', 'wf-admin', definition('wf case test'))).status).toBe(
      201,
    );
  });

  it('updates with If-Match, validating the merged definition', async () => {
    const got = await call('GET', `/workflows/${wfId}`, 'wf-manager');
    const etag = got.headers.etag as string;
    const ok = await call(
      'PATCH',
      `/workflows/${wfId}`,
      'wf-manager',
      { name: 'پیگیری موفق‌ها' },
      { 'if-match': etag },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('پیگیری موفق‌ها');
    // the same (now stale) tag is refused
    const stale = await call(
      'PATCH',
      `/workflows/${wfId}`,
      'wf-manager',
      { name: 'دوباره' },
      { 'if-match': etag },
    );
    expect(stale.status).toBe(412);
    // changing the trigger invalidates the old condition → 400, nothing written
    const merged = await call('PATCH', `/workflows/${wfId}`, 'wf-manager', {
      triggerType: 'lead.created',
    });
    expect(merged.status).toBe(400);
    expect((await call('GET', `/workflows/${wfId}`, 'wf-manager')).body.triggerType).toBe(
      'deal.stage_changed',
    );
    const audit = await prisma.auditLog.count({
      where: { action: 'workflow.updated', entityId: wfId },
    });
    expect(audit).toBe(1);
  });

  it('enables and disables idempotently, with audit entries', async () => {
    const on = await call('POST', `/workflows/${wfId}/enable`, 'wf-manager');
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(true);
    await call('POST', `/workflows/${wfId}/enable`, 'wf-manager');
    expect(
      await prisma.auditLog.count({ where: { action: 'workflow.enabled', entityId: wfId } }),
    ).toBe(1);
    const off = await call('POST', `/workflows/${wfId}/disable`, 'wf-manager');
    expect(off.body.enabled).toBe(false);
    expect(
      await prisma.auditLog.count({ where: { action: 'workflow.disabled', entityId: wfId } }),
    ).toBe(1);
  });

  it('refuses to enable more than 50 workflows', async () => {
    const filler = Array.from({ length: 50 }, (_, i) => ({
      organizationId: orgId,
      name: `wf-filler-${i}`,
      triggerType: 'lead.created',
      conditions: [],
      actions: [{ type: 'notify', to: 'owner', title: 't' }],
      enabled: true,
      createdById: ids['wf-admin']!,
    }));
    await prisma.workflow.createMany({ data: filler });
    try {
      const res = await call('POST', `/workflows/${wfId}/enable`, 'wf-admin');
      expect(res.status).toBe(409);
      expect(res.body.code ?? res.body.error?.code).toBe('TOO_MANY_WORKFLOWS');
    } finally {
      await prisma.workflow.deleteMany({ where: { name: { startsWith: 'wf-filler-' } } });
    }
    expect((await call('POST', `/workflows/${wfId}/enable`, 'wf-admin')).status).toBe(200);
    await call('POST', `/workflows/${wfId}/disable`, 'wf-admin');
  });

  it('lists with a cursor and hides other organizations completely', async () => {
    const foreign = await prisma.workflow.create({
      data: {
        organizationId: otherOrgId,
        name: 'wf-foreign',
        triggerType: 'lead.created',
        conditions: [],
        actions: [{ type: 'notify', to: 'owner', title: 't' }],
        createdById: ids['wf-admin'],
      },
    });
    const all = await call('GET', '/workflows?limit=2', 'wf-admin');
    expect(all.body.items.length).toBeLessThanOrEqual(2);
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Res = await call(
        'GET',
        `/workflows?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        'wf-admin',
      );
      names.push(...page.body.items.map((w: any) => w.name));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(names).toContain('پیگیری موفق‌ها');
    expect(names).not.toContain('wf-foreign');
    expect((await call('GET', `/workflows/${foreign.id}`, 'wf-admin')).status).toBe(404);
    expect(
      (await call('PATCH', `/workflows/${foreign.id}`, 'wf-admin', { name: 'ربودن' })).status,
    ).toBe(404);
    expect((await call('POST', `/workflows/${foreign.id}/enable`, 'wf-admin')).status).toBe(404);
    expect((await call('DELETE', `/workflows/${foreign.id}`, 'wf-admin')).status).toBe(404);
    expect((await call('GET', `/workflows/${foreign.id}/runs`, 'wf-admin')).status).toBe(404);
    const row = await prisma.workflow.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(row.deletedAt).toBeNull();
    expect(row.name).toBe('wf-foreign');
  });

  it('lists the run history newest first', async () => {
    const mk = (n: number) => ({
      workflowId: wfId,
      eventId: `0197c0de-0000-7000-8000-0000000000${10 + n}`,
      status: n === 2 ? 'FAILED' : 'SUCCEEDED',
      startedAt: new Date(),
      finishedAt: new Date(),
      steps: [{ action: 'notify', status: 'done' }],
      error: n === 2 ? 'خطا' : null,
    });
    for (const n of [1, 2, 3]) await prisma.workflowRun.create({ data: mk(n) });
    const p1 = await call('GET', `/workflows/${wfId}/runs?limit=2`, 'wf-manager');
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).not.toBeNull();
    expect(p1.body.items[0].eventId.endsWith('13')).toBe(true);
    const p2 = await call(
      'GET',
      `/workflows/${wfId}/runs?limit=2&cursor=${p1.body.nextCursor}`,
      'wf-manager',
    );
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0]).toMatchObject({ status: 'SUCCEEDED' });
    expect((await call('GET', `/workflows/${wfId}/runs?foo=1`, 'wf-manager')).status).toBe(400);
  });

  it('soft-deletes, disables and audits; only people with workflows.delete may', async () => {
    expect((await call('DELETE', `/workflows/${wfId}`, 'wf-sales')).status).toBe(403);
    expect((await call('DELETE', `/workflows/${wfId}`, 'wf-manager')).status).toBe(204);
    expect((await call('GET', `/workflows/${wfId}`, 'wf-manager')).status).toBe(404);
    const row = await prisma.workflow.findUniqueOrThrow({ where: { id: wfId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.enabled).toBe(false);
    expect(
      await prisma.auditLog.count({ where: { action: 'workflow.deleted', entityId: wfId } }),
    ).toBe(1);
  });

  it('enforces the database invariants', async () => {
    const base = {
      organizationId: orgId,
      name: 'wf-invariant',
      triggerType: 'lead.created',
      conditions: [],
      actions: [{ type: 'notify', to: 'owner', title: 't' }],
      createdById: ids['wf-admin'],
    };
    await expect(
      prisma.workflow.create({ data: { ...base, triggerType: 'user.deleted' } }),
    ).rejects.toThrow();
    await expect(prisma.workflow.create({ data: { ...base, actions: [] } })).rejects.toThrow();
    await expect(
      prisma.workflow.create({ data: { ...base, conditions: { a: 1 } } }),
    ).rejects.toThrow();
    await expect(prisma.workflow.create({ data: { ...base, name: 'x' } })).rejects.toThrow();
  });
});
