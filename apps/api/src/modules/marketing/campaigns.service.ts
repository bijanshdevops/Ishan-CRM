import { assertIfMatch, assertWritten, casWhere } from '../../common/etag';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CampaignDto,
  CampaignListQuery,
  CreateCampaignRequest,
  Page,
  UpdateCampaignRequest,
} from '@ishan/contracts';
import { normalizeText, parseRial } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { assertCanAssign, ownerWhere, resolveOwner } from '../../common/access-scope';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { campaignInclude, campaignSearchText, toCampaignDto } from './mappers';

const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00.000Z`);

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, q: CampaignListQuery): Promise<Page<CampaignDto>> {
    const term = q.q ? normalizeText(q.q) : '';
    const rows = await this.prisma.campaign.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...ownerWhere(actor),
        ...(q.status ? { status: q.status } : {}),
        ...(term ? { searchText: { contains: term } } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      include: campaignInclude,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toCampaignDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<CampaignDto> {
    const c = await this.prisma.campaign.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...ownerWhere(actor) },
      include: campaignInclude,
    });
    if (!c) throw new NotFoundException('کمپین یافت نشد');
    return toCampaignDto(c);
  }

  private async assertOwner(orgId: string, ownerId?: string | null) {
    if (!ownerId) return;
    const u = await this.prisma.user.findFirst({
      where: { id: ownerId, organizationId: orgId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!u) throw new BadRequestException({ code: 'INVALID_OWNER', message: 'مسئول نامعتبر است' });
  }

  async create(actor: AuthUser, dto: CreateCampaignRequest, ip?: string) {
    const ownerId = resolveOwner(actor, dto.ownerId);
    await this.assertOwner(actor.organizationId, ownerId);
    const c = await this.prisma.campaign.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        channel: dto.channel ?? null,
        status: dto.status,
        startDate: toDate(dto.startDate) ?? null,
        endDate: toDate(dto.endDate) ?? null,
        budget: parseRial(dto.budget),
        ownerId: ownerId ?? actor.id,
        createdById: actor.id,
        notes: dto.notes ?? null,
        searchText: campaignSearchText(dto),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'campaign.created',
      entityType: 'campaign',
      entityId: c.id,
      ip,
    });
    return this.get(actor, c.id);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateCampaignRequest,
    ip?: string,
    ifMatch?: string,
  ) {
    const existing = await this.prisma.campaign.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...ownerWhere(actor) },
    });
    if (!existing) throw new NotFoundException('کمپین یافت نشد');
    assertIfMatch(ifMatch, existing.updatedAt);
    if (dto.ownerId !== undefined) {
      assertCanAssign(actor, dto.ownerId);
      await this.assertOwner(actor.organizationId, dto.ownerId);
    }
    const startDate = dto.startDate === undefined ? existing.startDate : toDate(dto.startDate);
    const endDate = dto.endDate === undefined ? existing.endDate : toDate(dto.endDate);
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'پایان کمپین نمی‌تواند پیش از شروع باشد',
      });
    }
    const blank = <T>(v: T | null | undefined) => (v === '' ? null : v);
    const next = {
      name: dto.name,
      channel: blank(dto.channel),
      status: dto.status,
      startDate: toDate(dto.startDate),
      endDate: toDate(dto.endDate),
      budget: dto.budget === undefined ? undefined : parseRial(dto.budget),
      ownerId: dto.ownerId,
      notes: blank(dto.notes),
    };
    const data = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    const written = await this.prisma.campaign.updateMany({
      where: { ...casWhere(id, ifMatch, existing.updatedAt), deletedAt: null },
      data: {
        ...data,
        searchText: campaignSearchText({ ...existing, ...data } as typeof existing),
      },
    });
    assertWritten(written.count, ifMatch, new NotFoundException('کمپین یافت نشد'));
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'campaign.updated',
      entityType: 'campaign',
      entityId: id,
      metadata: { fields: Object.keys(data) },
      ip,
    });
    return this.get(actor, id);
  }

  /** Soft delete; leads keep their history but are detached by the FK on hard delete only. */
  async remove(actor: AuthUser, id: string, ip?: string) {
    const c = await this.prisma.campaign.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...ownerWhere(actor) },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('کمپین یافت نشد');
    await this.prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'campaign.deleted',
      entityType: 'campaign',
      entityId: id,
      ip,
    });
  }
}
