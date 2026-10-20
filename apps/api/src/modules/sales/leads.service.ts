import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ConvertLeadRequest,
  CreateLeadRequest,
  LeadDto,
  LeadListQuery,
  Page,
  UpdateLeadRequest,
} from '@ishan/contracts';
import { normalizeText, parseRial } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { contactSearchText, customerSearchText } from '../customers/mappers';
import { leadInclude, leadSearchText, toLeadDto } from './mappers';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, q: LeadListQuery): Promise<Page<LeadDto>> {
    const term = q.q ? normalizeText(q.q) : '';
    const rows = await this.prisma.lead.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.sourceId ? { sourceId: q.sourceId } : {}),
        ...(q.campaignId ? { campaignId: q.campaignId } : {}),
        ...(term ? { searchText: { contains: term } } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      include: leadInclude,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toLeadDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<LeadDto> {
    const l = await this.prisma.lead.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: leadInclude,
    });
    if (!l) throw new NotFoundException('سرنخ یافت نشد');
    return toLeadDto(l);
  }

  private async assertOwner(orgId: string, ownerId?: string | null) {
    if (!ownerId) return;
    const u = await this.prisma.user.findFirst({
      where: { id: ownerId, organizationId: orgId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!u) throw new BadRequestException({ code: 'INVALID_OWNER', message: 'مسئول نامعتبر است' });
  }

  /** Validates that the source and campaign belong to the organization; returns the source name. */
  private async assertRefs(
    orgId: string,
    sourceId?: string | null,
    campaignId?: string | null,
  ): Promise<string | null> {
    let sourceName: string | null = null;
    if (sourceId) {
      const src = await this.prisma.leadSource.findFirst({
        where: { id: sourceId, organizationId: orgId, active: true },
        select: { name: true },
      });
      if (!src)
        throw new BadRequestException({ code: 'INVALID_SOURCE', message: 'منبع سرنخ نامعتبر است' });
      sourceName = src.name;
    }
    if (campaignId) {
      const c = await this.prisma.campaign.findFirst({
        where: { id: campaignId, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      if (!c)
        throw new BadRequestException({ code: 'INVALID_CAMPAIGN', message: 'کمپین نامعتبر است' });
    }
    return sourceName;
  }

  async create(actor: AuthUser, dto: CreateLeadRequest, ip?: string) {
    await this.assertOwner(actor.organizationId, dto.ownerId);
    const sourceName = await this.assertRefs(actor.organizationId, dto.sourceId, dto.campaignId);
    const lead = await this.prisma.lead.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        company: dto.company ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        sourceId: dto.sourceId ?? null,
        campaignId: dto.campaignId ?? null,
        notes: dto.notes ?? null,
        ownerId: dto.ownerId ?? actor.id,
        createdById: actor.id,
        searchText: leadSearchText({ ...dto, sourceName }),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'lead.created',
      entityType: 'lead',
      entityId: lead.id,
      ip,
    });
    return this.get(actor, lead.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateLeadRequest, ip?: string) {
    const existing = await this.prisma.lead.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('سرنخ یافت نشد');
    if (existing.status === 'CONVERTED') {
      throw new BadRequestException({
        code: 'LEAD_CONVERTED',
        message: 'سرنخ تبدیل‌شده قابل ویرایش نیست',
      });
    }
    if (dto.ownerId !== undefined) await this.assertOwner(actor.organizationId, dto.ownerId);
    const checkedName = await this.assertRefs(actor.organizationId, dto.sourceId, dto.campaignId);
    const sourceName =
      dto.sourceId === undefined
        ? existing.sourceId
          ? ((
              await this.prisma.leadSource.findUnique({
                where: { id: existing.sourceId },
                select: { name: true },
              })
            )?.name ?? null)
          : null
        : checkedName;
    const blank = <T>(v: T | null | undefined) => (v === '' ? null : v);
    const next = {
      name: dto.name,
      company: blank(dto.company),
      email: blank(dto.email),
      phone: blank(dto.phone),
      sourceId: dto.sourceId,
      campaignId: dto.campaignId,
      notes: blank(dto.notes),
      ownerId: dto.ownerId,
      status: dto.status,
      disqualifyReason:
        dto.status && dto.status !== 'DISQUALIFIED' ? null : blank(dto.disqualifyReason),
    };
    const data = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    await this.prisma.lead.update({
      where: { id },
      data: {
        ...data,
        searchText: leadSearchText({ ...existing, ...data, sourceName } as typeof existing & {
          sourceName: string | null;
        }),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'lead.updated',
      entityType: 'lead',
      entityId: id,
      metadata: { fields: Object.keys(data) },
      ip,
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthUser, id: string, ip?: string) {
    const l = await this.prisma.lead.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!l) throw new NotFoundException('سرنخ یافت نشد');
    await this.prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'lead.deleted',
      entityType: 'lead',
      entityId: id,
      ip,
    });
  }

  /** Atomically turns a lead into a customer (+ contact) and optionally a deal. */
  async convert(actor: AuthUser, id: string, dto: ConvertLeadRequest, ip?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('سرنخ یافت نشد');
    if (lead.status === 'CONVERTED' || lead.status === 'DISQUALIFIED') {
      throw new BadRequestException({
        code: 'LEAD_NOT_CONVERTIBLE',
        message: 'این سرنخ قابل تبدیل نیست',
      });
    }
    let firstStageId: string | undefined;
    if (dto.deal) {
      const first = await this.prisma.pipelineStage.findFirst({
        where: { organizationId: actor.organizationId, kind: 'OPEN' },
        orderBy: { position: 'asc' },
      });
      if (!first)
        throw new BadRequestException({ code: 'NO_PIPELINE', message: 'قیف فروش تعریف نشده است' });
      firstStageId = first.id;
    }
    if (dto.customerId) {
      const c = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId: actor.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!c)
        throw new BadRequestException({ code: 'INVALID_CUSTOMER', message: 'مشتری نامعتبر است' });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let customerId = dto.customerId;
      let contactId: string | null = null;
      const [firstName, ...rest] = lead.name.split(' ');
      const lastName = rest.join(' ') || '-';
      if (!customerId) {
        const org = dto.customerKind === 'ORGANIZATION';
        const name = org ? (lead.company ?? lead.name) : lead.name;
        const customer = await tx.customer.create({
          data: {
            organizationId: actor.organizationId,
            kind: dto.customerKind,
            name,
            email: lead.email,
            phone: lead.phone,
            notes: lead.notes,
            ownerId: lead.ownerId ?? actor.id,
            createdById: actor.id,
            searchText: customerSearchText({ name, email: lead.email, phone: lead.phone }),
          },
        });
        customerId = customer.id;
        if (org) {
          const contact = await tx.contact.create({
            data: {
              organizationId: actor.organizationId,
              customerId,
              firstName: firstName ?? lead.name,
              lastName,
              email: lead.email,
              phone: lead.phone,
              isPrimary: true,
              searchText: contactSearchText({
                firstName: firstName ?? lead.name,
                lastName,
                email: lead.email,
                phone: lead.phone,
              }),
            },
          });
          contactId = contact.id;
        }
      }
      let dealId: string | null = null;
      if (dto.deal && firstStageId) {
        const deal = await tx.deal.create({
          data: {
            organizationId: actor.organizationId,
            title: dto.deal.title,
            customerId,
            contactId,
            stageId: firstStageId,
            amount: parseRial(dto.deal.amount),
            expectedCloseDate: dto.deal.expectedCloseDate
              ? new Date(dto.deal.expectedCloseDate)
              : null,
            ownerId: lead.ownerId ?? actor.id,
            createdById: actor.id,
          },
        });
        await tx.dealStageEvent.create({
          data: { dealId: deal.id, toStageId: firstStageId, actorId: actor.id },
        });
        dealId = deal.id;
      }
      await tx.lead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          convertedCustomerId: customerId,
          convertedDealId: dealId,
        },
      });
      return { customerId, dealId };
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'lead.converted',
      entityType: 'lead',
      entityId: id,
      metadata: result,
      ip,
    });
    return result;
  }
}
