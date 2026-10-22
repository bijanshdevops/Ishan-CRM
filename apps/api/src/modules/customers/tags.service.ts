import { assertIfMatch, assertWritten, casWhere } from '../../common/etag';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TagDto } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toTagDto } from './mappers';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser): Promise<TagDto[]> {
    const rows = await this.prisma.tag.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toTagDto);
  }

  private async assertUnique(orgId: string, name: string, exceptId?: string) {
    const dup = await this.prisma.tag.findFirst({
      where: { organizationId: orgId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (dup)
      throw new ConflictException({ code: 'TAG_NAME_TAKEN', message: 'نام برچسب تکراری است' });
  }

  async create(actor: AuthUser, dto: { name: string; color: string }, ip?: string) {
    await this.assertUnique(actor.organizationId, dto.name);
    const tag = await this.prisma.tag.create({
      data: { organizationId: actor.organizationId, name: dto.name, color: dto.color },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'tag.created',
      entityType: 'tag',
      entityId: tag.id,
      ip,
    });
    return toTagDto(tag);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: { name?: string; color?: string },
    ip?: string,
    ifMatch?: string,
  ) {
    const tag = await this.prisma.tag.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!tag) throw new NotFoundException('برچسب یافت نشد');
    assertIfMatch(ifMatch, tag.updatedAt);
    if (dto.name) await this.assertUnique(actor.organizationId, dto.name, id);
    const written = await this.prisma.tag.updateMany({
      where: casWhere(id, ifMatch, tag.updatedAt),
      data: dto,
    });
    assertWritten(written.count, ifMatch, new NotFoundException('برچسب یافت نشد'));
    const updated = await this.prisma.tag.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'tag.updated',
      entityType: 'tag',
      entityId: id,
      ip,
    });
    return toTagDto(updated);
  }

  async remove(actor: AuthUser, id: string, ip?: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!tag) throw new NotFoundException('برچسب یافت نشد');
    await this.prisma.tag.delete({ where: { id } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'tag.deleted',
      entityType: 'tag',
      entityId: id,
      ip,
    });
  }
}
