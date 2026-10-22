import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from './helpers';

/** Activities, reminders, calendar and the customer timeline against a real PostgreSQL (CI). */
const run = process.env.RUN_DB_TESTS === '1';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Activities-Spec-Passw0rd';
const MIN = 60_000;
const iso = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * MIN).toISOString();

interface Res {
  status: number;
  body: any;
}

describe.skipIf(!run)('activities (database)', () => {
  let app: NestFastifyApplication;
  let prisma: any;
  let otherOrgId = '';
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const roleOf: Record<string, string> = {
    'act-manager': 'manager',
    'act-rep': 'sales',
    'act-rep2': 'sales',
    'act-viewer': 'viewer',
  };

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
  });

  afterAll(async () => {
    if (prisma) {
      const ids = Object.values(userIds);
      await prisma.activity.deleteMany({ where: { createdById: { in: ids } } });
      if (otherOrgId) {
        await prisma.activity.deleteMany({ where: { organizationId: otherOrgId } });
        await prisma.organization.delete({ where: { id: otherOrgId } });
      }
      await prisma.deal.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.contact.deleteMany({ where: { customer: { createdById: { in: ids } } } });
      await prisma.customer.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  let customerId = '';
  let otherCustomerId = '';
  let contactId = '';
  let otherContactId = '';
  let dealId = '';
  let taskId = '';
  let meetingId = '';

  it('enforces authentication and permissions', async () => {
    expect((await call('GET', '/activities', null)).status).toBe(401);
    expect((await call('GET', '/activities/calendar', null)).status).toBe(401);
    expect((await call('GET', '/activities/reminders/due', null)).status).toBe(401);
    expect((await call('GET', '/activities', 'act-viewer')).status).toBe(200);
    expect(
      (await call('POST', '/activities', 'act-viewer', { type: 'NOTE', description: 'x' })).status,
    ).toBe(403);
    // sales reps may write but not hard-delete.
    const own = await call('POST', '/activities', 'act-rep', { type: 'NOTE', description: 'حذف' });
    expect(own.status).toBe(201);
    expect((await call('DELETE', `/activities/${own.body.id}`, 'act-rep')).status).toBe(403);
    expect((await call('DELETE', `/activities/${own.body.id}`, 'act-viewer')).status).toBe(403);
    expect((await call('DELETE', `/activities/${own.body.id}`, 'act-manager')).status).toBe(204);
    expect((await call('GET', `/activities/${own.body.id}`, 'act-rep')).status).toBe(404);
  });

  it('prepares customers, contacts and a deal', async () => {
    const c = await call('POST', '/customers', 'act-rep', {
      kind: 'ORGANIZATION',
      name: 'شرکت فعالیت',
    });
    expect(c.status).toBe(201);
    customerId = c.body.id;
    const c2 = await call('POST', '/customers', 'act-rep', { kind: 'PERSON', name: 'علی دیگر' });
    otherCustomerId = c2.body.id;
    const k = await call('POST', `/customers/${customerId}/contacts`, 'act-rep', {
      firstName: 'سارا',
      lastName: 'رضایی',
    });
    expect(k.status).toBe(201);
    contactId = k.body.id;
    const k2 = await call('POST', `/customers/${otherCustomerId}/contacts`, 'act-rep', {
      firstName: 'رضا',
      lastName: 'دیگر',
    });
    otherContactId = k2.body.id;
    const d = await call('POST', '/deals', 'act-rep', { title: 'فرصت فعالیت', customerId });
    expect(d.status).toBe(201);
    dealId = d.body.id;
  });

  it('validates the shape and references of an activity', async () => {
    const post = (body: unknown) => call('POST', '/activities', 'act-rep', body);
    expect((await post({ type: 'TASK', title: 'بدون زمان' })).status).toBe(400);
    expect((await post({ type: 'NOTE', description: 'x', dueAt: iso(10) })).status).toBe(400);
    expect((await post({ type: 'NOTE' })).status).toBe(400);
    expect(
      (await post({ type: 'MEETING', title: 'جلسه', dueAt: iso(60), endAt: iso(30) })).status,
    ).toBe(400);
    expect(
      (await post({ type: 'TASK', title: 'کار', dueAt: iso(60), endAt: iso(90) })).status,
    ).toBe(400);
    expect(
      (await post({ type: 'TASK', title: 'کار', dueAt: iso(60), remindAt: iso(120) })).status,
    ).toBe(400);
    expect(
      (await post({ type: 'CALL', title: 'تماس', status: 'DONE', completedAt: iso(600) })).status,
    ).toBe(400);
    const missing = '0197c0de-0000-7000-8000-000000000000';
    expect(
      (await post({ type: 'TASK', title: 'کار', dueAt: iso(60), customerId: missing })).status,
    ).toBe(400);
    expect(
      (await post({ type: 'TASK', title: 'کار', dueAt: iso(60), assigneeId: missing })).status,
    ).toBe(400);
    expect(
      (await post({ type: 'TASK', title: 'کار', dueAt: iso(60), dealId: missing })).status,
    ).toBe(400);
    // a contact of another customer is rejected
    expect(
      (
        await post({
          type: 'TASK',
          title: 'کار',
          dueAt: iso(60),
          customerId,
          contactId: otherContactId,
        })
      ).status,
    ).toBe(400);
    // a disabled user cannot be assigned
    await prisma.user.update({ where: { id: userIds['act-rep2'] }, data: { status: 'DISABLED' } });
    expect(
      (
        await post({
          type: 'TASK',
          title: 'کار',
          dueAt: iso(60),
          assigneeId: userIds['act-rep2'],
        })
      ).status,
    ).toBe(400);
    await prisma.user.update({ where: { id: userIds['act-rep2'] }, data: { status: 'ACTIVE' } });
  });

  it('creates tasks, meetings, calls and notes linked to the customer file', async () => {
    const task = await call('POST', '/activities', 'act-rep', {
      type: 'TASK',
      title: 'ارسال پیش‌فاکتور',
      description: 'ارسال پیش‌فاکتور ويژه',
      dueAt: iso(24 * 60),
      remindAt: iso(23 * 60),
      priority: 'HIGH',
      customerId,
      contactId,
    });
    expect(task.status).toBe(201);
    taskId = task.body.id;
    expect(task.body.status).toBe('PLANNED');
    expect(task.body.assignee.id).toBe(userIds['act-rep']);
    expect(task.body.createdBy.id).toBe(userIds['act-rep']);
    expect(task.body.customer.id).toBe(customerId);
    expect(task.body.contact.name).toBe('سارا رضایی');
    expect(task.body.overdue).toBe(false);

    const meeting = await call('POST', '/activities', 'act-rep', {
      type: 'MEETING',
      title: 'جلسه معرفی',
      dueAt: iso(48 * 60),
      endAt: iso(49 * 60),
      dealId,
    });
    expect(meeting.status).toBe(201);
    meetingId = meeting.body.id;
    // the customer is derived from the deal
    expect(meeting.body.customer.id).toBe(customerId);
    expect(meeting.body.deal.id).toBe(dealId);

    const call1 = await call('POST', '/activities', 'act-rep', {
      type: 'CALL',
      title: 'تماس معرفی',
      status: 'DONE',
      completedAt: iso(-120),
      outcome: 'علاقه‌مند بود',
      customerId,
    });
    expect(call1.status).toBe(201);
    expect(call1.body.status).toBe('DONE');
    expect(call1.body.completedAt).not.toBeNull();

    const note = await call('POST', '/activities', 'act-rep', {
      type: 'NOTE',
      description: 'مشتری درخواست تخفیف حجمی دارد. پیگیری شود.',
      customerId,
      completedAt: iso(-180),
    });
    expect(note.status).toBe(201);
    expect(note.body.status).toBe('DONE');
    expect(note.body.assignee).toBeNull();
    expect(note.body.title.length).toBeGreaterThan(5);
  });

  it('filters, searches and paginates', async () => {
    const byCustomer = await call('GET', `/activities?customerId=${customerId}`, 'act-viewer');
    expect(byCustomer.status).toBe(200);
    expect(byCustomer.body.items).toHaveLength(4);
    const notes = await call('GET', `/activities?customerId=${customerId}&type=NOTE`, 'act-viewer');
    expect(notes.body.items).toHaveLength(1);
    const planned = await call(
      'GET',
      `/activities?customerId=${customerId}&status=PLANNED`,
      'act-viewer',
    );
    expect(planned.body.items).toHaveLength(2);
    // Arabic yeh in the stored text matches the Persian query
    const q = await call('GET', `/activities?q=${encodeURIComponent('ویژه')}`, 'act-viewer');
    expect(q.body.items.map((a: any) => a.id)).toContain(taskId);

    const first = await call(
      'GET',
      `/activities?customerId=${customerId}&status=PLANNED&sort=due&limit=1`,
      'act-viewer',
    );
    expect(first.body.items.map((a: any) => a.id)).toEqual([taskId]);
    expect(first.body.nextCursor).toBe(taskId);
    const second = await call(
      'GET',
      `/activities?customerId=${customerId}&status=PLANNED&sort=due&limit=1&cursor=${first.body.nextCursor}`,
      'act-viewer',
    );
    expect(second.body.items.map((a: any) => a.id)).toEqual([meetingId]);
    expect(second.body.nextCursor).toBeNull();
    expect((await call('GET', '/activities?cursor=not-a-uuid', 'act-viewer')).status).toBe(400);
    expect((await call('GET', `/activities?assigneeId=me`, 'act-rep2')).body.items).toEqual([]);
  });

  it('flags overdue work', async () => {
    const t = await call('POST', '/activities', 'act-rep', {
      type: 'TASK',
      title: 'کار عقب‌افتاده',
      dueAt: iso(-60),
    });
    expect(t.status).toBe(201);
    expect(t.body.overdue).toBe(true);
    const list = await call('GET', '/activities?overdue=true&assigneeId=me', 'act-rep');
    expect(list.body.items.map((a: any) => a.id)).toContain(t.body.id);
    expect(list.body.items.every((a: any) => a.overdue)).toBe(true);
    expect(list.body.items.map((a: any) => a.id)).not.toContain(taskId);
  });

  it('only the assignee, creator or a manager can change an activity', async () => {
    expect(
      (await call('PATCH', `/activities/${taskId}`, 'act-rep2', { title: 'تغییر غیرمجاز' })).status,
    ).toBe(403);
    expect((await call('POST', `/activities/${taskId}/complete`, 'act-rep2', {})).status).toBe(403);
    expect((await call('POST', `/activities/${taskId}/cancel`, 'act-viewer')).status).toBe(403);
    // a manager may edit anyone's activity
    const byManager = await call('PATCH', `/activities/${taskId}`, 'act-manager', {
      priority: 'NORMAL',
    });
    expect(byManager.status).toBe(200);
    expect(byManager.body.priority).toBe('NORMAL');
    // an assignee may work on a task somebody else created
    const delegated = await call('POST', '/activities', 'act-manager', {
      type: 'TASK',
      title: 'کار محول‌شده',
      dueAt: iso(30),
      assigneeId: userIds['act-rep2'],
    });
    expect(delegated.status).toBe(201);
    expect(
      (await call('POST', `/activities/${delegated.body.id}/complete`, 'act-rep2', {})).status,
    ).toBe(200);
  });

  it('delivers and dismisses reminders for the assignee only', async () => {
    const t = await call('POST', '/activities', 'act-rep', {
      type: 'TASK',
      title: 'تماس یادآوری',
      dueAt: iso(120),
      remindAt: iso(-1),
    });
    expect(t.status).toBe(201);
    const ids = (r: Res) => r.body.map((a: any) => a.id);
    expect(ids(await call('GET', '/activities/reminders/due', 'act-rep'))).toContain(t.body.id);
    // not yet due, and not for other users
    expect(ids(await call('GET', '/activities/reminders/due', 'act-rep'))).not.toContain(taskId);
    expect(ids(await call('GET', '/activities/reminders/due', 'act-rep2'))).not.toContain(
      t.body.id,
    );
    expect(
      (await call('POST', `/activities/${t.body.id}/reminder/dismiss`, 'act-rep2')).status,
    ).toBe(403);
    expect(
      (await call('POST', `/activities/${t.body.id}/reminder/dismiss`, 'act-rep')).status,
    ).toBe(204);
    expect(ids(await call('GET', '/activities/reminders/due', 'act-rep'))).not.toContain(t.body.id);
    // moving the reminder re-arms it
    const moved = await call('PATCH', `/activities/${t.body.id}`, 'act-rep', { remindAt: iso(-2) });
    expect(moved.body.reminderDismissed).toBe(false);
    expect(ids(await call('GET', '/activities/reminders/due', 'act-rep'))).toContain(t.body.id);
    // completing removes it
    await call('POST', `/activities/${t.body.id}/complete`, 'act-rep', {});
    expect(ids(await call('GET', '/activities/reminders/due', 'act-rep'))).not.toContain(t.body.id);
  });

  it('runs the task lifecycle: complete, reopen, cancel', async () => {
    const t = await call('POST', '/activities', 'act-rep', {
      type: 'TASK',
      title: 'چرخه عمر',
      dueAt: iso(90),
      remindAt: iso(30),
      customerId,
    });
    const id = t.body.id;
    const done = await call('POST', `/activities/${id}/complete`, 'act-rep', {
      outcome: 'انجام شد',
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('DONE');
    expect(done.body.completedAt).not.toBeNull();
    expect(done.body.remindAt).toBeNull();
    expect(done.body.outcome).toBe('انجام شد');
    expect((await call('POST', `/activities/${id}/complete`, 'act-rep', {})).status).toBe(400);
    expect((await call('PATCH', `/activities/${id}`, 'act-rep', { dueAt: iso(200) })).status).toBe(
      400,
    );
    const reopened = await call('POST', `/activities/${id}/reopen`, 'act-rep');
    expect(reopened.body.status).toBe('PLANNED');
    expect(reopened.body.completedAt).toBeNull();
    const canceled = await call('POST', `/activities/${id}/cancel`, 'act-rep');
    expect(canceled.body.status).toBe('CANCELED');
    expect((await call('POST', `/activities/${id}/cancel`, 'act-rep')).status).toBe(400);
    expect((await call('POST', `/activities/${id}/reopen`, 'act-rep')).body.status).toBe('PLANNED');

    // notes and unscheduled logged calls cannot be reopened
    const note = await call('POST', '/activities', 'act-rep', {
      type: 'NOTE',
      description: 'ثابت',
    });
    expect((await call('POST', `/activities/${note.body.id}/reopen`, 'act-rep')).status).toBe(400);
    expect((await call('POST', `/activities/${note.body.id}/complete`, 'act-rep', {})).status).toBe(
      400,
    );
    const logged = await call('POST', '/activities', 'act-rep', {
      type: 'CALL',
      title: 'ثبت‌شده',
      status: 'DONE',
    });
    expect((await call('POST', `/activities/${logged.body.id}/reopen`, 'act-rep')).status).toBe(
      400,
    );
    // the database rejects shapes the API would never produce
    await expect(
      prisma.activity.update({ where: { id: note.body.id }, data: { dueAt: new Date() } }),
    ).rejects.toThrow();
  });

  it('serves a bounded calendar window', async () => {
    const day = (n: number) => iso(n * 24 * 60);
    const far = await call('POST', '/activities', 'act-rep', {
      type: 'TASK',
      title: 'خارج از بازه',
      dueAt: day(40),
    });
    const cancelled = await call('POST', '/activities', 'act-rep', {
      type: 'TASK',
      title: 'لغوشده تقویم',
      dueAt: day(3),
    });
    await call('POST', `/activities/${cancelled.body.id}/cancel`, 'act-rep');
    const res = await call(
      'GET',
      `/activities/calendar?from=${encodeURIComponent(day(-1))}&to=${encodeURIComponent(day(10))}`,
      'act-viewer',
    );
    expect(res.status).toBe(200);
    const ids = res.body.items.map((a: any) => a.id);
    expect(res.body.truncated).toBe(false);
    expect(ids).toContain(taskId);
    expect(ids).toContain(meetingId);
    expect(ids).not.toContain(far.body.id);
    expect(ids).not.toContain(cancelled.body.id);
    const times = res.body.items.map((a: any) => a.dueAt);
    expect(times).toEqual([...times].sort());
    const mine = await call(
      'GET',
      `/activities/calendar?from=${encodeURIComponent(day(-1))}&to=${encodeURIComponent(day(10))}&assigneeId=me`,
      'act-rep2',
    );
    expect(mine.body.items.map((a: any) => a.id)).not.toContain(taskId);
    // windows are bounded and validated
    expect(
      (
        await call(
          'GET',
          `/activities/calendar?from=${encodeURIComponent(day(0))}&to=${encodeURIComponent(day(90))}`,
          'act-rep',
        )
      ).status,
    ).toBe(400);
    expect((await call('GET', '/activities/calendar', 'act-rep')).status).toBe(400);
  });

  it('builds the customer timeline from finished work and deal stage changes', async () => {
    const stages = (await call('GET', '/pipeline/stages', 'act-rep')).body;
    await call('POST', `/deals/${dealId}/move`, 'act-rep', { stageId: stages[1].id });
    expect((await call('GET', `/customers/${customerId}/timeline`, null)).status).toBe(401);
    const all: any[] = [];
    let before: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Res = await call(
        'GET',
        `/customers/${customerId}/timeline?limit=2${before ? `&before=${encodeURIComponent(before)}` : ''}`,
        'act-viewer',
      );
      expect(page.status).toBe(200);
      all.push(...page.body.items);
      before = page.body.nextBefore;
      if (!before) break;
    }
    expect(before).toBeNull();
    const ids = all.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kinds = all.map((i) => i.kind);
    expect(kinds.filter((k) => k === 'deal_stage')).toHaveLength(2);
    // finished call + note + the logged call from the lifecycle test, never planned work
    const acts = all.filter((i) => i.kind === 'activity').map((i) => i.activity);
    expect(acts.every((a: any) => a.status === 'DONE')).toBe(true);
    expect(acts.map((a: any) => a.title)).toContain('تماس معرفی');
    expect(acts.map((a: any) => a.id)).not.toContain(taskId);
    const times = all.map((i) => i.occurredAt);
    expect(times).toEqual([...times].sort().reverse());
    const move = all.find((i) => i.kind === 'deal_stage' && i.fromStage !== null);
    expect(move.toStage).toBe(stages[1].name);
    expect(move.fromStage).toBe(stages[0].name);
    expect(move.actor.name).toBe('act-rep');
    // unknown customer
    expect(
      (await call('GET', '/customers/0197c0de-0000-7000-8000-000000000000/timeline', 'act-rep'))
        .status,
    ).toBe(404);
  });

  it('isolates organizations', async () => {
    const other = await prisma.organization.create({ data: { name: 'spec-other-org' } });
    otherOrgId = other.id;
    const foreign = await prisma.activity.create({
      data: {
        organizationId: other.id,
        type: 'NOTE',
        status: 'DONE',
        title: 'خارجی',
        completedAt: new Date(),
      },
    });
    expect((await call('GET', `/activities/${foreign.id}`, 'act-manager')).status).toBe(404);
    expect(
      (await call('PATCH', `/activities/${foreign.id}`, 'act-manager', { title: 'نه' })).status,
    ).toBe(404);
    expect((await call('DELETE', `/activities/${foreign.id}`, 'act-manager')).status).toBe(404);
    const list = await call('GET', '/activities?limit=100', 'act-manager');
    expect(list.body.items.map((a: any) => a.id)).not.toContain(foreign.id);
  });

  it('hides the activities of a deleted customer and audits every change', async () => {
    const del = await call('DELETE', `/customers/${otherCustomerId}`, 'act-manager');
    expect(del.status).toBe(204);
    const a = await call('POST', '/activities', 'act-rep', {
      type: 'NOTE',
      description: 'قبل از حذف',
      customerId: customerId,
    });
    expect(a.status).toBe(201);
    // attach an activity to the soon-deleted customer directly, then delete the customer
    const hidden = await prisma.activity.create({
      data: {
        organizationId: (await prisma.user.findUniqueOrThrow({ where: { id: userIds['act-rep'] } }))
          .organizationId,
        type: 'NOTE',
        status: 'DONE',
        title: 'پنهان',
        completedAt: new Date(),
        createdById: userIds['act-rep'],
        customerId: otherCustomerId,
      },
    });
    expect((await call('GET', `/activities/${hidden.id}`, 'act-manager')).status).toBe(404);
    expect(
      (await call('GET', `/activities?customerId=${otherCustomerId}`, 'act-manager')).body.items,
    ).toEqual([]);
    expect(
      (await call('GET', `/customers/${otherCustomerId}/timeline`, 'act-manager')).status,
    ).toBe(404);
    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'activity', entityId: taskId },
      select: { action: true },
    });
    expect(audits.map((x: any) => x.action)).toContain('activity.created');
    expect(audits.map((x: any) => x.action)).toContain('activity.updated');
    expect((await prisma.auditLog.count({ where: { action: 'activity.deleted' } })) >= 1).toBe(
      true,
    );
  });
});
