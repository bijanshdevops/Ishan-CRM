import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  NotificationDto,
  NotificationEntityType,
  NotificationListQuery,
  NotificationType,
  Page,
  UnreadCountDto,
} from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
  workflowRunId?: string | null;
}

interface Row {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export const toNotificationDto = (r: Row): NotificationDto => ({
  id: r.id,
  type: r.type as NotificationDto['type'],
  title: r.title,
  body: r.body,
  entityType: r.entityType as NotificationDto['entityType'],
  entityId: r.entityId,
  read: r.readAt !== null,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Per-recipient in-app notifications (ADR 0011). Every read and write below is scoped to the
 * calling user's id; another user's notification looks exactly like a missing one (404).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, q: NotificationListQuery): Promise<Page<NotificationDto>> {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId: actor.id,
        ...(q.unread ? { readAt: null } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toNotificationDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async unreadCount(actor: AuthUser): Promise<UnreadCountDto> {
    return {
      count: await this.prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
    };
  }

  async markRead(actor: AuthUser, id: string): Promise<NotificationDto> {
    const existing = await this.prisma.notification.findFirst({ where: { id, userId: actor.id } });
    if (!existing) throw new NotFoundException('اعلان یافت نشد');
    if (existing.readAt) return toNotificationDto(existing);
    // Compare-and-set: two tabs marking the same notification keep the first read time.
    await this.prisma.notification.updateMany({
      where: { id, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    const fresh = await this.prisma.notification.findFirstOrThrow({
      where: { id, userId: actor.id },
    });
    return toNotificationDto(fresh);
  }

  async markAllRead(actor: AuthUser): Promise<UnreadCountDto> {
    await this.prisma.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: 0 };
  }

  /** Used by the workflow engine (slice 7c); not exposed over HTTP. */
  async create(input: NewNotification, db: Pick<PrismaService, 'notification'> = this.prisma) {
    return db.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body ? input.body.slice(0, 1000) : null,
        entityType: input.entityType ?? null,
        entityId: input.entityType ? (input.entityId ?? null) : null,
        workflowRunId: input.workflowRunId ?? null,
      },
    });
  }
}
