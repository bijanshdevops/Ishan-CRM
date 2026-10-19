import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ContactDto,
  CreateContactRequest,
} from '@ishan/contracts';
import type { z } from 'zod';
import type { UpdateContactRequestSchema } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { contactSearchText, nullify, toContactDto } from './mappers';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertCustomer(actor: AuthUser, customerId: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('مشتری یافت نشد');
  }

  async listForCustomer(actor: AuthUser, customerId: string): Promise<ContactDto[]> {
    await this.assertCustomer(actor, customerId);
    const rows = await this.prisma.contact.findMany({
      where: { customerId, organizationId: actor.organizationId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toContactDto);
  }

  async create(actor: AuthUser, customerId: string, dto: CreateContactRequest, ip?: string) {
    await this.assertCustomer(actor, customerId);
    const contact = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.contact.updateMany({ where: { customerId }, data: { isPrimary: false } });
      }
      return tx.contact.create({
        data: {
          organizationId: actor.organizationId,
          customerId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          jobTitle: dto.jobTitle ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          mobile: dto.mobile ?? null,
          isPrimary: dto.isPrimary,
          notes: dto.notes ?? null,
          searchText: contactSearchText(dto),
        },
      });
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'contact.created',
      entityType: 'contact',
      entityId: contact.id,
      metadata: { customerId },
      ip,
    });
    return toContactDto(contact);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: z.infer<typeof UpdateContactRequestSchema>,
    ip?: string,
  ) {
    const existing = await this.prisma.contact.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('مخاطب یافت نشد');
    const next = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      jobTitle: nullify(dto.jobTitle),
      email: nullify(dto.email),
      phone: nullify(dto.phone),
      mobile: nullify(dto.mobile),
      isPrimary: dto.isPrimary,
      notes: nullify(dto.notes),
    };
    const data = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    const merged = { ...existing, ...data } as typeof existing;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary && existing.customerId) {
        await tx.contact.updateMany({
          where: { customerId: existing.customerId, id: { not: id } },
          data: { isPrimary: false },
        });
      }
      return tx.contact.update({
        where: { id },
        data: { ...data, searchText: contactSearchText(merged) },
      });
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'contact.updated',
      entityType: 'contact',
      entityId: id,
      ip,
    });
    return toContactDto(updated);
  }

  async remove(actor: AuthUser, id: string, ip?: string) {
    const existing = await this.prisma.contact.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('مخاطب یافت نشد');
    await this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'contact.deleted',
      entityType: 'contact',
      entityId: id,
      ip,
    });
  }
}
