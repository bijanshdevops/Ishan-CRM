import { assertIfMatch, hasPrecondition, staleEntity, unchangedSince } from '../../common/etag';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateCustomerRequest,
  CustomerDetailDto,
  CustomerDto,
  CustomerListQuery,
  Page,
  SearchResultDto,
  UpdateCustomerRequest,
} from '@ishan/contracts';
import { normalizeText } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  contactSearchText,
  customerInclude,
  customerSearchText,
  nullify,
  toContactDto,
  toCustomerDto,
} from './mappers';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  buildWhere(orgId: string, q: Omit<CustomerListQuery, 'limit' | 'cursor'>) {
    const term = q.q ? normalizeText(q.q) : '';
    return {
      organizationId: orgId,
      deletedAt: null,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.tagId ? { tags: { some: { tagId: q.tagId } } } : {}),
      ...(term ? { searchText: { contains: term } } : {}),
    };
  }

  async list(actor: AuthUser, q: CustomerListQuery): Promise<Page<CustomerDto>> {
    const rows = await this.prisma.customer.findMany({
      where: {
        ...this.buildWhere(actor.organizationId, q),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      include: customerInclude,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toCustomerDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<CustomerDetailDto> {
    const c = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: {
        ...customerInclude,
        contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
      },
    });
    if (!c) throw new NotFoundException('مشتری یافت نشد');
    return { ...toCustomerDto(c), contacts: c.contacts.map(toContactDto) };
  }

  private async assertOwner(orgId: string, ownerId?: string | null) {
    if (!ownerId) return;
    const u = await this.prisma.user.findFirst({
      where: { id: ownerId, organizationId: orgId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!u) throw new BadRequestException({ code: 'INVALID_OWNER', message: 'مسئول نامعتبر است' });
  }

  async create(actor: AuthUser, dto: CreateCustomerRequest, ip?: string) {
    await this.assertOwner(actor.organizationId, dto.ownerId);
    const created = await this.prisma.customer.create({
      data: {
        organizationId: actor.organizationId,
        kind: dto.kind,
        name: dto.name,
        nationalId: dto.nationalId ?? null,
        economicCode: dto.economicCode ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        website: dto.website ?? null,
        province: dto.province ?? null,
        city: dto.city ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
        ownerId: dto.ownerId ?? actor.id,
        createdById: actor.id,
        searchText: customerSearchText(dto),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'customer.created',
      entityType: 'customer',
      entityId: created.id,
      ip,
    });
    return this.get(actor, created.id);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateCustomerRequest,
    ip?: string,
    ifMatch?: string,
  ) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('مشتری یافت نشد');
    assertIfMatch(ifMatch, existing.updatedAt);
    if (dto.ownerId !== undefined) await this.assertOwner(actor.organizationId, dto.ownerId);

    const next = {
      kind: dto.kind,
      name: dto.name,
      nationalId: nullify(dto.nationalId),
      economicCode: nullify(dto.economicCode),
      email: nullify(dto.email),
      phone: nullify(dto.phone),
      website: nullify(dto.website),
      province: nullify(dto.province),
      city: nullify(dto.city),
      address: nullify(dto.address),
      notes: nullify(dto.notes),
      ownerId: dto.ownerId,
    };
    const data = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    const merged = { ...existing, ...data } as typeof existing;
    // Compare-and-set: with If-Match the row must still be the one the client saw.
    const written = await this.prisma.customer.updateMany({
      where: { id, ...(hasPrecondition(ifMatch) ? unchangedSince(existing.updatedAt) : {}) },
      data: { ...data, searchText: customerSearchText(merged) },
    });
    if (written.count === 0)
      throw hasPrecondition(ifMatch) ? staleEntity() : new NotFoundException('مشتری یافت نشد');
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'customer.updated',
      entityType: 'customer',
      entityId: id,
      metadata: { fields: Object.keys(data) },
      ip,
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthUser, id: string, ip?: string) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('مشتری یافت نشد');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.customer.update({ where: { id }, data: { deletedAt: now } }),
      this.prisma.contact.updateMany({
        where: { customerId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'customer.deleted',
      entityType: 'customer',
      entityId: id,
      ip,
    });
  }

  async setTags(actor: AuthUser, id: string, tagIds: string[], ip?: string) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('مشتری یافت نشد');
    const unique = [...new Set(tagIds)];
    const found = await this.prisma.tag.count({
      where: { id: { in: unique }, organizationId: actor.organizationId },
    });
    if (found !== unique.length) {
      throw new BadRequestException({ code: 'INVALID_TAG', message: 'برچسب نامعتبر است' });
    }
    await this.prisma.$transaction([
      this.prisma.customerTag.deleteMany({ where: { customerId: id } }),
      this.prisma.customerTag.createMany({
        data: unique.map((tagId) => ({ customerId: id, tagId })),
      }),
    ]);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'customer.tags_set',
      entityType: 'customer',
      entityId: id,
      metadata: { tagIds: unique },
      ip,
    });
    return this.get(actor, id);
  }

  async search(actor: AuthUser, q: string): Promise<SearchResultDto> {
    const term = normalizeText(q);
    if (term.length < 2) return { customers: [], contacts: [] };
    const [customers, contacts] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          organizationId: actor.organizationId,
          deletedAt: null,
          searchText: { contains: term },
        },
        select: { id: true, name: true, kind: true },
        orderBy: { id: 'desc' },
        take: 8,
      }),
      this.prisma.contact.findMany({
        where: {
          organizationId: actor.organizationId,
          deletedAt: null,
          searchText: { contains: term },
        },
        select: { id: true, firstName: true, lastName: true, customerId: true },
        orderBy: { id: 'desc' },
        take: 8,
      }),
    ]);
    return {
      customers,
      contacts: contacts.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        customerId: c.customerId,
      })),
    };
  }

  // used by contacts service
  contactSearch = contactSearchText;
}
