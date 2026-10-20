import { assertIfMatch } from '../../common/etag';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateDealRequest,
  DealDto,
  DealListQuery,
  FunnelDto,
  Page,
  UpdateDealRequest,
} from '@ishan/contracts';
import { parseRial } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { dealInclude, toDealDto, toStageDto } from './mappers';

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, q: DealListQuery): Promise<Page<DealDto>> {
    const rows = await this.prisma.deal.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(q.stageId ? { stageId: q.stageId } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.q
          ? {
              OR: [
                { title: { contains: q.q, mode: 'insensitive' as const } },
                { customer: { name: { contains: q.q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      include: dealInclude,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toDealDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<DealDto> {
    const d = await this.prisma.deal.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: dealInclude,
    });
    if (!d) throw new NotFoundException('فرصت یافت نشد');
    return toDealDto(d);
  }

  private async assertRefs(
    actor: AuthUser,
    refs: { customerId?: string; contactId?: string | null; ownerId?: string | null },
  ) {
    const org = actor.organizationId;
    if (refs.customerId) {
      const c = await this.prisma.customer.findFirst({
        where: { id: refs.customerId, organizationId: org, deletedAt: null },
        select: { id: true },
      });
      if (!c)
        throw new BadRequestException({ code: 'INVALID_CUSTOMER', message: 'مشتری نامعتبر است' });
    }
    if (refs.contactId) {
      const c = await this.prisma.contact.findFirst({
        where: {
          id: refs.contactId,
          organizationId: org,
          deletedAt: null,
          ...(refs.customerId ? { customerId: refs.customerId } : {}),
        },
        select: { id: true },
      });
      if (!c)
        throw new BadRequestException({ code: 'INVALID_CONTACT', message: 'مخاطب نامعتبر است' });
    }
    if (refs.ownerId) {
      const u = await this.prisma.user.findFirst({
        where: { id: refs.ownerId, organizationId: org, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!u)
        throw new BadRequestException({ code: 'INVALID_OWNER', message: 'مسئول نامعتبر است' });
    }
  }

  async create(actor: AuthUser, dto: CreateDealRequest, ip?: string): Promise<DealDto> {
    await this.assertRefs(actor, dto);
    let stageId = dto.stageId;
    if (stageId) {
      const s = await this.prisma.pipelineStage.findFirst({
        where: { id: stageId, organizationId: actor.organizationId },
      });
      if (!s)
        throw new BadRequestException({ code: 'INVALID_STAGE', message: 'مرحله نامعتبر است' });
      if (s.kind !== 'OPEN') {
        throw new BadRequestException({
          code: 'INVALID_STAGE',
          message: 'فرصت جدید باید در یک مرحله باز شروع شود',
        });
      }
    } else {
      const first = await this.prisma.pipelineStage.findFirst({
        where: { organizationId: actor.organizationId, kind: 'OPEN' },
        orderBy: { position: 'asc' },
      });
      if (!first)
        throw new BadRequestException({ code: 'NO_PIPELINE', message: 'قیف فروش تعریف نشده است' });
      stageId = first.id;
    }
    const deal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          organizationId: actor.organizationId,
          title: dto.title,
          customerId: dto.customerId,
          contactId: dto.contactId ?? null,
          stageId: stageId!,
          amount: parseRial(dto.amount),
          expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
          ownerId: dto.ownerId ?? actor.id,
          createdById: actor.id,
          notes: dto.notes ?? null,
        },
      });
      await tx.dealStageEvent.create({
        data: { dealId: created.id, toStageId: stageId!, actorId: actor.id },
      });
      return created;
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'deal.created',
      entityType: 'deal',
      entityId: deal.id,
      ip,
    });
    return this.get(actor, deal.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateDealRequest, ip?: string, ifMatch?: string) {
    const existing = await this.prisma.deal.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('فرصت یافت نشد');
    assertIfMatch(ifMatch, existing.updatedAt);
    await this.assertRefs(actor, {
      customerId: existing.customerId,
      contactId: dto.contactId,
      ownerId: dto.ownerId,
    });
    const data = {
      title: dto.title,
      contactId: dto.contactId,
      amount: dto.amount !== undefined ? parseRial(dto.amount) : undefined,
      expectedCloseDate:
        dto.expectedCloseDate === undefined
          ? undefined
          : dto.expectedCloseDate === null
            ? null
            : new Date(dto.expectedCloseDate),
      ownerId: dto.ownerId,
      notes: dto.notes === '' ? null : dto.notes,
    };
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    await this.prisma.deal.update({ where: { id }, data: clean });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'deal.updated',
      entityType: 'deal',
      entityId: id,
      metadata: { fields: Object.keys(clean) },
      ip,
    });
    return this.get(actor, id);
  }

  async move(
    actor: AuthUser,
    id: string,
    stageId: string,
    lostReason: string | undefined,
    ip?: string,
  ) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!deal) throw new NotFoundException('فرصت یافت نشد');
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, organizationId: actor.organizationId },
    });
    if (!stage)
      throw new BadRequestException({ code: 'INVALID_STAGE', message: 'مرحله نامعتبر است' });
    if (deal.stageId === stageId) return this.get(actor, id);

    const closing = stage.kind !== 'OPEN';
    await this.prisma.$transaction([
      this.prisma.deal.update({
        where: { id },
        data: {
          stageId,
          closedAt: closing ? new Date() : null,
          lostReason: stage.kind === 'LOST' ? (lostReason ?? null) : null,
        },
      }),
      this.prisma.dealStageEvent.create({
        data: { dealId: id, fromStageId: deal.stageId, toStageId: stageId, actorId: actor.id },
      }),
    ]);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'deal.stage_changed',
      entityType: 'deal',
      entityId: id,
      metadata: { from: deal.stageId, to: stageId, kind: stage.kind },
      ip,
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthUser, id: string, ip?: string) {
    const d = await this.prisma.deal.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('فرصت یافت نشد');
    await this.prisma.deal.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'deal.deleted',
      entityType: 'deal',
      entityId: id,
      ip,
    });
  }

  async funnel(actor: AuthUser): Promise<FunnelDto> {
    const [stages, groups] = await Promise.all([
      this.prisma.pipelineStage.findMany({
        where: { organizationId: actor.organizationId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.deal.groupBy({
        by: ['stageId'],
        where: { organizationId: actor.organizationId, deletedAt: null },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    const byStage = new Map(groups.map((g) => [g.stageId, g]));
    let openCount = 0;
    let openAmount = 0n;
    let weighted = 0n;
    let wonAmount = 0n;
    let wonCount = 0;
    let lostCount = 0;
    const rows = stages.map((s) => {
      const g = byStage.get(s.id);
      const count = g?._count._all ?? 0;
      const amount = g?._sum.amount ?? 0n;
      const w = (amount * BigInt(s.probability)) / 100n;
      if (s.kind === 'OPEN') {
        openCount += count;
        openAmount += amount;
        weighted += w;
      } else if (s.kind === 'WON') {
        wonCount += count;
        wonAmount += amount;
      } else lostCount += count;
      return { ...toStageDto(s), count, amount: amount.toString(), weightedAmount: w.toString() };
    });
    return {
      stages: rows,
      totals: {
        openCount,
        openAmount: openAmount.toString(),
        weightedAmount: weighted.toString(),
        wonAmount: wonAmount.toString(),
        wonCount,
        lostCount,
      },
    };
  }
}
