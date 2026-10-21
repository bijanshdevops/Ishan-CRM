import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** In-app notifications against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Notif-Spec-Passw0rd';

interface Res {
  status: number;
  body: any;
}

describe.skipIf(!run)('notifications (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'notif-admin': 'admin',
    'notif-manager': 'manager',
    'notif-sales': 'sales',
    'notif-viewer': 'viewer',
  };

  async function call(
    method: 'GET' | 'POST',
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

  async function give(who: string, title: string, extra: Record<string, unknown> = {}) {
    return prisma.notification.create({
      data: { userId: ids[who], type: 'workflow', title, ...extra },
    });
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
  });

  afterAll(async () => {
    if (prisma) {
      const all = Object.values(ids);
      await prisma.notification.deleteMany({ where: { userId: { in: all } } });
      await prisma.user.deleteMany({ where: { id: { in: all } } });
    }
    await app?.close();
  });

  it('requires authentication on every endpoint', async () => {
    expect((await call('GET', '/notifications', null)).status).toBe(401);
    expect((await call('GET', '/notifications/unread-count', null)).status).toBe(401);
    expect((await call('POST', '/notifications/read-all', null)).status).toBe(401);
    expect(
      (await call('POST', '/notifications/0197c0de-0000-7000-8000-000000000000/read', null)).status,
    ).toBe(401);
  });

  it('lets every role use its own inbox without any permission', async () => {
    for (const who of Object.keys(roleOf)) {
      expect((await call('GET', '/notifications', who)).status).toBe(200);
      expect((await call('GET', '/notifications/unread-count', who)).body).toEqual({ count: 0 });
    }
  });

  it('shows each user only their own notifications', async () => {
    const a = await give('notif-sales', 'برای فروش');
    await give('notif-viewer', 'برای بیننده');
    const mine = await call('GET', '/notifications', 'notif-sales');
    expect(mine.body.items.map((n: any) => n.id)).toEqual([a.id]);
    expect(mine.body.items[0]).toMatchObject({
      title: 'برای فروش',
      read: false,
      body: null,
      entityType: null,
    });
    expect((await call('GET', '/notifications/unread-count', 'notif-sales')).body.count).toBe(1);
    // an admin does not see other people's notifications either
    expect((await call('GET', '/notifications', 'notif-admin')).body.items).toEqual([]);
  });

  it("answers 404, not 403, for another user's notification and never changes it", async () => {
    const n = await give('notif-manager', 'محرمانه');
    const res = await call('POST', `/notifications/${n.id}/read`, 'notif-admin');
    expect(res.status).toBe(404);
    expect((await call('POST', `/notifications/${n.id}/read`, 'notif-viewer')).status).toBe(404);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.readAt).toBeNull();
    expect(
      (
        await call(
          'POST',
          '/notifications/0197c0de-0000-7000-8000-000000000000/read',
          'notif-admin',
        )
      ).status,
    ).toBe(404);
    expect((await call('POST', '/notifications/not-a-uuid/read', 'notif-admin')).status).toBe(400);
  });

  it('marks one as read once and keeps the first read time', async () => {
    const n = await give('notif-admin', 'خوانده می‌شود', {
      entityType: 'deal',
      entityId: '0197c0de-0000-7000-8000-0000000000aa',
    });
    const first = await call('POST', `/notifications/${n.id}/read`, 'notif-admin');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ read: true, entityType: 'deal' });
    const stamp = (await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt;
    await call('POST', `/notifications/${n.id}/read`, 'notif-admin');
    const again = (await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt;
    expect(again.getTime()).toBe(stamp.getTime());
    expect((await call('GET', '/notifications/unread-count', 'notif-admin')).body.count).toBe(0);
  });

  it('pages with a cursor, filters unread and marks everything read for the caller only', async () => {
    for (let i = 0; i < 5; i++) await give('notif-manager', `پیام ${i}`);
    const p1 = await call('GET', '/notifications?limit=3', 'notif-manager');
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextCursor).not.toBeNull();
    const p2 = await call(
      'GET',
      `/notifications?limit=3&cursor=${p1.body.nextCursor}`,
      'notif-manager',
    );
    const seen = [...p1.body.items, ...p2.body.items].map((n: any) => n.id);
    expect(new Set(seen).size).toBe(seen.length);
    // newest first
    expect(p1.body.items[0].title).toBe('پیام 4');

    const before = (await call('GET', '/notifications/unread-count', 'notif-viewer')).body.count;
    const all = await call('POST', '/notifications/read-all', 'notif-manager');
    expect(all.status).toBe(200);
    expect((await call('GET', '/notifications/unread-count', 'notif-manager')).body.count).toBe(0);
    expect(
      (await call('GET', '/notifications?unread=true', 'notif-manager')).body.items,
    ).toHaveLength(0);
    expect((await call('GET', '/notifications/unread-count', 'notif-viewer')).body.count).toBe(
      before,
    );
  });

  it('rejects unknown or invalid query parameters', async () => {
    expect((await call('GET', '/notifications?limit=0', 'notif-admin')).status).toBe(400);
    expect((await call('GET', '/notifications?limit=500', 'notif-admin')).status).toBe(400);
    expect((await call('GET', '/notifications?foo=1', 'notif-admin')).status).toBe(400);
    expect((await call('GET', '/notifications?unread=maybe', 'notif-admin')).status).toBe(400);
  });

  it('enforces the database invariants', async () => {
    await expect(give('notif-admin', '')).rejects.toThrow();
    await expect(give('notif-admin', 'x'.repeat(201))).rejects.toThrow();
    await expect(give('notif-admin', 'نوع', { type: 'other' })).rejects.toThrow();
    await expect(give('notif-admin', 'پیوند ناقص', { entityType: 'deal' })).rejects.toThrow();
  });

  it('is removed together with its user', async () => {
    const org = await prisma.organization.findFirstOrThrow({ where: { deletedAt: null } });
    const role = await prisma.role.findFirstOrThrow({
      where: { organizationId: org.id, key: 'viewer' },
    });
    const u = await prisma.user.create({
      data: {
        organizationId: org.id,
        roleId: role.id,
        email: 'notif-temp@example.com',
        name: 'temp',
        passwordHash: 'x',
      },
    });
    await prisma.notification.create({ data: { userId: u.id, type: 'system', title: 't' } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0);
  });
});
