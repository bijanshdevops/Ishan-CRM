import { assertIfMatch, assertWritten, casWhere } from '../../common/etag';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateLeadSourceRequest,
  LeadSourceDto,
  UpdateLeadSourceRequest,
} from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toLeadSourceDto } from './mappers';

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

@Injectable()
export class LeadSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Small configuration list: returned whole, active first. */
  async list(actor: AuthUser, activeOnly = false): Promise<LeadSourceDto[]> {
    const rows = await this.prisma.leadSource.findMany({
      where: { organizationId: actor.organizationId, ...(activeOnly ? { active: true } : {}) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toLeadSourceDto);
  }

  async create(actor: AuthUser, dto: CreateLeadSourceRequest, ip?: string) {
    try {
      const s = await this.prisma.leadSource.create({
        data: { organizationId: actor.organizationId, name: dto.name },
      });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'lead_source.created',
        entityType: 'lead_source',
        entityId: s.id,
        ip,
      });
      return toLeadSourceDto(s);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'SOURCE_EXISTS',
          message: 'این منبع قبلاً ثبت شده است',
        });
      }
      throw e;
    }
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateLeadSourceRequest,
    ip?: string,
    ifMatch?: string,
  ) {
    const existing = await this.prisma.leadSource.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: { id: true, updatedAt: true },
    });
    if (!existing) throw new NotFoundException('منبع سرنخ یافت نشد');
    assertIfMatch(ifMatch, existing.updatedAt);
    try {
      const written = await this.prisma.leadSource.updateMany({
        where: casWhere(id, ifMatch, existing.updatedAt),
        data: { name: dto.name, active: dto.active },
      });
      assertWritten(written.count, ifMatch, new NotFoundException('منبع سرنخ یافت نشد'));
      const s = await this.prisma.leadSource.findUniqueOrThrow({ where: { id } });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'lead_source.updated',
        entityType: 'lead_source',
        entityId: id,
        metadata: { fields: Object.keys(dto) },
        ip,
      });
      return toLeadSourceDto(s);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'SOURCE_EXISTS',
          message: 'این منبع قبلاً ثبت شده است',
        });
      }
      throw e;
    }
  }
}
