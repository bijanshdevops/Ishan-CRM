import { assertIfMatch, assertWritten, casWhere } from '../../common/etag';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StageDto } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toStageDto } from './mappers';

@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser): Promise<StageDto[]> {
    const rows = await this.prisma.pipelineStage.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { position: 'asc' },
    });
    return rows.map(toStageDto);
  }

  private async find(actor: AuthUser, id: string) {
    const s = await this.prisma.pipelineStage.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!s) throw new NotFoundException('مرحله یافت نشد');
    return s;
  }

  private async assertNameFree(orgId: string, name: string, exceptId?: string) {
    const dup = await this.prisma.pipelineStage.findFirst({
      where: { organizationId: orgId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (dup) {
      throw new ConflictException({ code: 'STAGE_NAME_TAKEN', message: 'نام مرحله تکراری است' });
    }
  }

  async create(
    actor: AuthUser,
    dto: { name: string; probability: number; kind: 'OPEN' | 'WON' | 'LOST' },
    ip?: string,
  ) {
    await this.assertNameFree(actor.organizationId, dto.name);
    const last = await this.prisma.pipelineStage.aggregate({
      where: { organizationId: actor.organizationId },
      _max: { position: true },
    });
    const stage = await this.prisma.pipelineStage.create({
      data: {
        organizationId: actor.organizationId,
        ...dto,
        position: (last._max.position ?? -1) + 1,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'pipeline.stage_created',
      entityType: 'pipeline_stage',
      entityId: stage.id,
      ip,
    });
    return toStageDto(stage);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: { name?: string; probability?: number; kind?: 'OPEN' | 'WON' | 'LOST' },
    ip?: string,
    ifMatch?: string,
  ) {
    const stage = await this.find(actor, id);
    assertIfMatch(ifMatch, stage.updatedAt);
    if (dto.name) await this.assertNameFree(actor.organizationId, dto.name, id);
    if (dto.kind && dto.kind !== stage.kind && stage.kind === 'OPEN') {
      const openLeft = await this.prisma.pipelineStage.count({
        where: { organizationId: actor.organizationId, kind: 'OPEN', id: { not: id } },
      });
      if (openLeft === 0) {
        throw new BadRequestException({
          code: 'LAST_OPEN_STAGE',
          message: 'حداقل یک مرحله باز باید باقی بماند',
        });
      }
    }
    const written = await this.prisma.pipelineStage.updateMany({
      where: casWhere(id, ifMatch, stage.updatedAt),
      data: dto,
    });
    assertWritten(written.count, ifMatch, new NotFoundException('مرحله یافت نشد'));
    const updated = await this.prisma.pipelineStage.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'pipeline.stage_updated',
      entityType: 'pipeline_stage',
      entityId: id,
      ip,
    });
    return toStageDto(updated);
  }

  async reorder(actor: AuthUser, stageIds: string[], ip?: string) {
    const all = await this.prisma.pipelineStage.findMany({
      where: { organizationId: actor.organizationId },
      select: { id: true },
    });
    const same =
      all.length === stageIds.length &&
      new Set(stageIds).size === stageIds.length &&
      all.every((s) => stageIds.includes(s.id));
    if (!same) {
      throw new BadRequestException({
        code: 'INVALID_ORDER',
        message: 'فهرست مراحل باید شامل همه مراحل باشد',
      });
    }
    await this.prisma.$transaction(
      stageIds.map((id, position) =>
        this.prisma.pipelineStage.update({ where: { id }, data: { position } }),
      ),
    );
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'pipeline.reordered',
      entityType: 'pipeline_stage',
      ip,
    });
    return this.list(actor);
  }

  async remove(actor: AuthUser, id: string, ip?: string) {
    const stage = await this.find(actor, id);
    const deals = await this.prisma.deal.count({ where: { stageId: id, deletedAt: null } });
    if (deals > 0) {
      throw new ConflictException({
        code: 'STAGE_IN_USE',
        message: 'در این مرحله فرصت فعال وجود دارد',
      });
    }
    if (stage.kind === 'OPEN') {
      const openLeft = await this.prisma.pipelineStage.count({
        where: { organizationId: actor.organizationId, kind: 'OPEN', id: { not: id } },
      });
      if (openLeft === 0) {
        throw new BadRequestException({
          code: 'LAST_OPEN_STAGE',
          message: 'حداقل یک مرحله باز باید باقی بماند',
        });
      }
    }
    // Soft-deleted deals may still reference the stage; detach by blocking via FK if so.
    try {
      await this.prisma.pipelineStage.delete({ where: { id } });
    } catch {
      throw new ConflictException({
        code: 'STAGE_IN_USE',
        message: 'این مرحله در سابقه فرصت‌ها استفاده شده است',
      });
    }
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'pipeline.stage_deleted',
      entityType: 'pipeline_stage',
      entityId: id,
      ip,
    });
  }
}
