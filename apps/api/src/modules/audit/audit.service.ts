import { Injectable } from '@nestjs/common';
import type { Page } from '@ishan/contracts';
import { PrismaService } from '../../infra/prisma.service';

export interface AuditEntry {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? undefined) as never,
        ip: entry.ip ?? null,
      },
    });
  }

  async list(
    organizationId: string,
    opts: { limit: number; cursor?: string; action?: string; entityType?: string },
  ): Promise<Page<AuditLogDto>> {
    // uuid v7 ids are time-ordered, so id order == chronological order.
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        ...(opts.action ? { action: opts.action } : {}),
        ...(opts.entityType ? { entityType: opts.entityType } : {}),
        ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: opts.limit + 1,
    });
    const items = rows.slice(0, opts.limit).map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > opts.limit ? (items.at(-1)?.id ?? null) : null };
  }
}
