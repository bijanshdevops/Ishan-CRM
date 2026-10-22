import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type {
  ActivityDto,
  ActivityListQuery,
  CalendarDto,
  CalendarQuery,
  CompleteActivityRequest,
  CreateActivityRequest,
  Page,
  TimelineItemDto,
  TimelinePageDto,
  TimelineQuery,
  UpdateActivityRequest,
} from '@ishan/contracts';
import { PERMISSIONS, checkActivityShape, normalizeText } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { activityScopeWhere, assertCanAssign, ownerWhere } from '../../common/access-scope';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { activityInclude, activitySearchText, toActivityDto } from './mappers';

/** Completion times may lead the server clock slightly (client clock skew). */
const FUTURE_SKEW_MS = 5 * 60_000;
const CALENDAR_CAP = 500;
const REMINDER_CAP = 50;

const bad = (code: string, message: string) => new BadRequestException({ code, message });

type Links = { customerId: string | null; contactId: string | null; dealId: string | null };

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- visibility / ownership -----------------------------------------

  /** Activities attached to a soft-deleted customer are hidden with it. */
  private baseWhere(actor: AuthUser): Prisma.ActivityWhereInput {
    return {
      organizationId: actor.organizationId,
      deletedAt: null,
      AND: [
        { OR: [{ customerId: null }, { customer: { deletedAt: null } }] },
        activityScopeWhere(actor),
      ],
    };
  }

  private canModify(
    actor: AuthUser,
    a: { assigneeId: string | null; createdById: string | null },
  ): boolean {
    return (
      actor.permissions.includes(PERMISSIONS.ACTIVITIES_MANAGE_ALL) ||
      a.assigneeId === actor.id ||
      a.createdById === actor.id
    );
  }

  private async load(actor: AuthUser, id: string) {
    const a = await this.prisma.activity.findFirst({
      where: { id, ...this.baseWhere(actor) },
      include: activityInclude,
    });
    if (!a) throw new NotFoundException('فعالیت یافت نشد');
    return a;
  }

  private async loadForWrite(actor: AuthUser, id: string) {
    const a = await this.load(actor, id);
    if (!this.canModify(actor, a)) {
      throw new ForbiddenException('فقط مسئول، سازنده یا مدیر می‌تواند این فعالیت را تغییر دهد');
    }
    return a;
  }

  private resolveAssignee(actor: AuthUser, v: string | undefined): string | undefined {
    return v === 'me' ? actor.id : v;
  }

  // ---- reads ----------------------------------------------------------

  async list(actor: AuthUser, q: ActivityListQuery): Promise<Page<ActivityDto>> {
    const now = new Date();
    const and: Prisma.ActivityWhereInput[] = [this.baseWhere(actor)];
    if (q.type) and.push({ type: q.type });
    if (q.status) and.push({ status: q.status });
    const assignee = this.resolveAssignee(actor, q.assigneeId);
    if (assignee) and.push({ assigneeId: assignee });
    if (q.customerId) and.push({ customerId: q.customerId });
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.dealId) and.push({ dealId: q.dealId });
    if (q.from) and.push({ dueAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ dueAt: { lte: new Date(q.to) } });
    if (q.overdue) and.push({ status: 'PLANNED', dueAt: { lt: now } });
    if (q.q) and.push({ searchText: { contains: normalizeText(q.q) } });

    let orderBy: Prisma.ActivityOrderByWithRelationInput[] = [{ id: 'desc' }];
    if (q.sort === 'due') {
      and.push({ dueAt: { not: null } });
      orderBy = [{ dueAt: 'asc' }, { id: 'asc' }];
    }
    if (q.cursor) {
      const c = await this.prisma.activity.findFirst({
        where: { id: q.cursor, ...this.baseWhere(actor) },
        select: { id: true, dueAt: true },
      });
      if (!c) throw bad('INVALID_CURSOR', 'نشانگر صفحه‌بندی نامعتبر است');
      if (q.sort === 'due' && c.dueAt) {
        and.push({
          OR: [{ dueAt: { gt: c.dueAt } }, { dueAt: c.dueAt, id: { gt: c.id } }],
        });
      } else {
        and.push({ id: { lt: q.cursor } });
      }
    }
    const rows = await this.prisma.activity.findMany({
      where: { AND: and },
      include: activityInclude,
      orderBy,
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map((r) => toActivityDto(r, now));
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<ActivityDto> {
    return toActivityDto(await this.load(actor, id));
  }

  async calendar(actor: AuthUser, q: CalendarQuery): Promise<CalendarDto> {
    const now = new Date();
    const assignee = this.resolveAssignee(actor, q.assigneeId);
    const rows = await this.prisma.activity.findMany({
      where: {
        AND: [
          this.baseWhere(actor),
          { status: { in: ['PLANNED', 'DONE'] } },
          { dueAt: { gte: new Date(q.from), lt: new Date(q.to) } },
          ...(assignee ? [{ assigneeId: assignee }] : []),
        ],
      },
      include: activityInclude,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: CALENDAR_CAP + 1,
    });
    return {
      items: rows.slice(0, CALENDAR_CAP).map((r) => toActivityDto(r, now)),
      truncated: rows.length > CALENDAR_CAP,
    };
  }

  /** Reminders that have come due for the signed-in user and were not dismissed. */
  async dueReminders(actor: AuthUser): Promise<ActivityDto[]> {
    const now = new Date();
    const rows = await this.prisma.activity.findMany({
      where: {
        AND: [
          this.baseWhere(actor),
          {
            assigneeId: actor.id,
            status: 'PLANNED',
            remindAt: { lte: now },
            reminderDismissedAt: null,
          },
        ],
      },
      include: activityInclude,
      orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
      take: REMINDER_CAP,
    });
    return rows.map((r) => toActivityDto(r, now));
  }

  // ---- references -----------------------------------------------------

  private async resolveLinks(
    actor: AuthUser,
    l: { customerId?: string | null; contactId?: string | null; dealId?: string | null },
  ): Promise<Links> {
    const org = actor.organizationId;
    let customerId = l.customerId ?? null;
    const contactId = l.contactId ?? null;
    const dealId = l.dealId ?? null;

    if (dealId) {
      const d = await this.prisma.deal.findFirst({
        where: { id: dealId, organizationId: org, deletedAt: null, ...ownerWhere(actor) },
        select: { customerId: true },
      });
      if (!d) throw bad('INVALID_DEAL', 'فرصت فروش نامعتبر است');
      if (customerId && customerId !== d.customerId) {
        throw bad('INVALID_DEAL', 'فرصت فروش متعلق به این مشتری نیست');
      }
      customerId = d.customerId;
    }
    if (contactId) {
      const c = await this.prisma.contact.findFirst({
        where: {
          id: contactId,
          organizationId: org,
          deletedAt: null,
          ...(actor.scopeUserIds === null
            ? {}
            : { customer: { is: { deletedAt: null, ...ownerWhere(actor) } } }),
        },
        select: { customerId: true },
      });
      if (!c) throw bad('INVALID_CONTACT', 'مخاطب نامعتبر است');
      if (c.customerId) {
        if (customerId && customerId !== c.customerId) {
          throw bad('INVALID_CONTACT', 'مخاطب متعلق به این مشتری نیست');
        }
        customerId = c.customerId;
      }
    }
    if (customerId) {
      const c = await this.prisma.customer.findFirst({
        where: { id: customerId, organizationId: org, deletedAt: null, ...ownerWhere(actor) },
        select: { id: true },
      });
      if (!c) throw bad('INVALID_CUSTOMER', 'مشتری نامعتبر است');
    }
    return { customerId, contactId, dealId };
  }

  private async assertAssignee(actor: AuthUser, id: string | null | undefined) {
    if (!id) return;
    assertCanAssign(actor, id);
    const u = await this.prisma.user.findFirst({
      where: { id, organizationId: actor.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!u) throw bad('INVALID_ASSIGNEE', 'مسئول نامعتبر است');
  }

  private assertNotFuture(at: Date) {
    if (at.getTime() > Date.now() + FUTURE_SKEW_MS) {
      throw bad('INVALID_COMPLETED_AT', 'زمان انجام نمی‌تواند در آینده باشد');
    }
  }

  // ---- writes ---------------------------------------------------------

  async create(actor: AuthUser, dto: CreateActivityRequest, ip?: string): Promise<ActivityDto> {
    const status = dto.status ?? (dto.type === 'NOTE' ? 'DONE' : 'PLANNED');
    const links = await this.resolveLinks(actor, dto);
    const assigneeId =
      dto.assigneeId === undefined ? (dto.type === 'NOTE' ? null : actor.id) : dto.assigneeId;
    await this.assertAssignee(actor, assigneeId);

    let completedAt: Date | null = null;
    if (status === 'DONE') {
      completedAt = dto.completedAt ? new Date(dto.completedAt) : new Date();
      this.assertNotFuture(completedAt);
    }
    const title =
      dto.type === 'NOTE'
        ? ((dto.title?.trim() ||
            (dto.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)) as string)
        : (dto.title as string);

    const created = await this.prisma.activity.create({
      data: {
        organizationId: actor.organizationId,
        type: dto.type,
        status,
        priority: dto.priority,
        title,
        description: dto.description ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        completedAt,
        outcome: dto.outcome ?? null,
        remindAt: dto.remindAt ? new Date(dto.remindAt) : null,
        assigneeId,
        createdById: actor.id,
        ...links,
        searchText: activitySearchText({
          title,
          description: dto.description,
          outcome: dto.outcome,
        }),
      },
      select: { id: true },
    });
    await this.record(actor, 'activity.created', created.id, { type: dto.type, status }, ip);
    return this.get(actor, created.id);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateActivityRequest,
    ip?: string,
  ): Promise<ActivityDto> {
    const cur = await this.loadForWrite(actor, id);
    const touchesSchedule =
      dto.dueAt !== undefined || dto.endAt !== undefined || dto.remindAt !== undefined;
    if (touchesSchedule && cur.status !== 'PLANNED') {
      throw bad('NOT_PLANNED', 'زمان‌بندی فقط برای فعالیت برنامه‌ریزی‌شده قابل تغییر است');
    }
    if (cur.type === 'NOTE' && (touchesSchedule || dto.priority !== undefined)) {
      throw bad('INVALID_ACTIVITY', 'یادداشت زمان‌بندی یا اولویت ندارد');
    }

    const merged = {
      title: dto.title ?? cur.title,
      description: dto.description === undefined ? cur.description : dto.description || null,
      dueAt: dto.dueAt === undefined ? cur.dueAt : dto.dueAt ? new Date(dto.dueAt) : null,
      endAt: dto.endAt === undefined ? cur.endAt : dto.endAt ? new Date(dto.endAt) : null,
      remindAt:
        dto.remindAt === undefined ? cur.remindAt : dto.remindAt ? new Date(dto.remindAt) : null,
    };
    const problem = checkActivityShape({ type: cur.type, status: cur.status, ...merged });
    if (problem) throw bad('INVALID_ACTIVITY', problem);

    const linkInput = {
      customerId: dto.customerId === undefined ? cur.customerId : dto.customerId,
      contactId: dto.contactId === undefined ? cur.contactId : dto.contactId,
      dealId: dto.dealId === undefined ? cur.dealId : dto.dealId,
    };
    const linksChanged =
      dto.customerId !== undefined || dto.contactId !== undefined || dto.dealId !== undefined;
    const links = linksChanged ? await this.resolveLinks(actor, linkInput) : undefined;
    if (dto.assigneeId !== undefined) await this.assertAssignee(actor, dto.assigneeId);

    const outcome = dto.outcome === undefined ? cur.outcome : dto.outcome || null;
    const reminderChanged =
      dto.remindAt !== undefined || (dto.dueAt !== undefined && cur.remindAt !== null);
    await this.prisma.activity.update({
      where: { id },
      data: {
        title: merged.title,
        description: merged.description,
        dueAt: merged.dueAt,
        endAt: merged.endAt,
        remindAt: merged.remindAt,
        ...(reminderChanged ? { reminderDismissedAt: null } : {}),
        ...(dto.priority ? { priority: dto.priority } : {}),
        outcome,
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        ...(links ?? {}),
        searchText: activitySearchText({
          title: merged.title,
          description: merged.description,
          outcome,
        }),
      },
    });
    await this.record(actor, 'activity.updated', id, { fields: Object.keys(dto) }, ip);
    return this.get(actor, id);
  }

  async complete(
    actor: AuthUser,
    id: string,
    dto: CompleteActivityRequest,
    ip?: string,
  ): Promise<ActivityDto> {
    const cur = await this.loadForWrite(actor, id);
    if (cur.status !== 'PLANNED') {
      throw bad('NOT_PLANNED', 'فقط فعالیت برنامه‌ریزی‌شده قابل تکمیل است');
    }
    const completedAt = dto.completedAt ? new Date(dto.completedAt) : new Date();
    this.assertNotFuture(completedAt);
    const outcome = dto.outcome ?? cur.outcome;
    await this.prisma.activity.update({
      where: { id },
      data: {
        status: 'DONE',
        completedAt,
        outcome,
        remindAt: null,
        reminderDismissedAt: null,
        searchText: activitySearchText({
          title: cur.title,
          description: cur.description,
          outcome,
        }),
      },
    });
    await this.record(actor, 'activity.completed', id, { type: cur.type }, ip);
    return this.get(actor, id);
  }

  async reopen(actor: AuthUser, id: string, ip?: string): Promise<ActivityDto> {
    const cur = await this.loadForWrite(actor, id);
    if (cur.type === 'NOTE' || cur.status === 'PLANNED') {
      throw bad('NOT_REOPENABLE', 'این فعالیت قابل بازگشایی نیست');
    }
    if (!cur.dueAt) {
      throw bad('NOT_REOPENABLE', 'فعالیت بدون زمان برنامه‌ریزی قابل بازگشایی نیست');
    }
    await this.prisma.activity.update({
      where: { id },
      data: { status: 'PLANNED', completedAt: null },
    });
    await this.record(actor, 'activity.reopened', id, { type: cur.type }, ip);
    return this.get(actor, id);
  }

  async cancel(actor: AuthUser, id: string, ip?: string): Promise<ActivityDto> {
    const cur = await this.loadForWrite(actor, id);
    if (cur.status !== 'PLANNED') {
      throw bad('NOT_PLANNED', 'فقط فعالیت برنامه‌ریزی‌شده قابل لغو است');
    }
    await this.prisma.activity.update({
      where: { id },
      data: { status: 'CANCELED', remindAt: null, reminderDismissedAt: null },
    });
    await this.record(actor, 'activity.canceled', id, { type: cur.type }, ip);
    return this.get(actor, id);
  }

  async dismissReminder(actor: AuthUser, id: string, ip?: string): Promise<void> {
    const cur = await this.loadForWrite(actor, id);
    if (cur.reminderDismissedAt) return;
    await this.prisma.activity.update({
      where: { id },
      data: { reminderDismissedAt: new Date() },
    });
    await this.record(actor, 'activity.reminder_dismissed', id, {}, ip);
  }

  async remove(actor: AuthUser, id: string, ip?: string): Promise<void> {
    const cur = await this.loadForWrite(actor, id);
    await this.prisma.activity.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.record(actor, 'activity.deleted', id, { type: cur.type }, ip);
  }

  // ---- customer interaction history ----------------------------------

  /**
   * Finished interactions with a customer (calls, meetings, finished tasks, notes)
   * merged with the stage changes of its deals, newest first.
   * Pagination is by timestamp (`before`); two items sharing the same millisecond
   * at a page boundary are the only theoretical gap.
   */
  async timeline(actor: AuthUser, customerId: string, q: TimelineQuery): Promise<TimelinePageDto> {
    const org = actor.organizationId;
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: org, deletedAt: null, ...ownerWhere(actor) },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('مشتری یافت نشد');
    const before = q.before ? new Date(q.before) : undefined;
    const now = new Date();

    const activities = await this.prisma.activity.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        customerId,
        status: 'DONE',
        ...(before ? { completedAt: { lt: before } } : {}),
      },
      include: activityInclude,
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });

    const items: TimelineItemDto[] = activities.map((a) => ({
      kind: 'activity',
      id: a.id,
      occurredAt: (a.completedAt ?? a.createdAt).toISOString(),
      activity: toActivityDto(a, now),
    }));

    if (actor.permissions.includes(PERMISSIONS.DEALS_READ)) {
      const events = await this.prisma.dealStageEvent.findMany({
        where: {
          deal: { customerId, organizationId: org, deletedAt: null, ...ownerWhere(actor) },
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        include: { deal: { select: { id: true, title: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      const stageIds = [
        ...new Set(events.flatMap((e) => [e.fromStageId, e.toStageId]).filter(Boolean)),
      ] as string[];
      const actorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))] as string[];
      const [stages, users] = await Promise.all([
        this.prisma.pipelineStage.findMany({
          where: { organizationId: org, id: { in: stageIds } },
          select: { id: true, name: true },
        }),
        this.prisma.user.findMany({
          where: { organizationId: org, id: { in: actorIds } },
          select: { id: true, name: true },
        }),
      ]);
      const stageName = new Map(stages.map((s) => [s.id, s.name]));
      const userById = new Map(users.map((u) => [u.id, u]));
      for (const e of events) {
        items.push({
          kind: 'deal_stage',
          id: e.id,
          occurredAt: e.createdAt.toISOString(),
          deal: e.deal,
          fromStage: e.fromStageId ? (stageName.get(e.fromStageId) ?? null) : null,
          toStage: stageName.get(e.toStageId) ?? '—',
          actor: e.actorId ? (userById.get(e.actorId) ?? null) : null,
        });
      }
    }

    items.sort((a, b) =>
      a.occurredAt === b.occurredAt
        ? b.id.localeCompare(a.id)
        : b.occurredAt.localeCompare(a.occurredAt),
    );
    const page = items.slice(0, q.limit);
    return {
      items: page,
      nextBefore: items.length > q.limit ? (page.at(-1)?.occurredAt ?? null) : null,
    };
  }

  private record(
    actor: AuthUser,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    ip?: string,
  ) {
    return this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action,
      entityType: 'activity',
      entityId,
      metadata,
      ip,
    });
  }
}
