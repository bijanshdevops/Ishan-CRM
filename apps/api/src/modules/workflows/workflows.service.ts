import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WORKFLOW_MAX_ENABLED,
  checkWorkflowDefinition,
  workflowCatalog,
  type CreateWorkflowRequest,
  type Page,
  type UpdateWorkflowRequest,
  type WorkflowAction,
  type WorkflowCatalogDto,
  type WorkflowCondition,
  type WorkflowDto,
  type WorkflowRunDto,
  type WorkflowRunListQuery,
  type WorkflowRunStep,
} from '@ishan/contracts';
import { assertIfMatch, hasPrecondition, staleEntity, unchangedSince } from '../../common/etag';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  conditions: unknown;
  actions: unknown;
  enabled: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export const toWorkflowDto = (w: WorkflowRow): WorkflowDto => ({
  id: w.id,
  name: w.name,
  description: w.description,
  triggerType: w.triggerType as WorkflowDto['triggerType'],
  conditions: w.conditions as WorkflowCondition[],
  actions: w.actions as WorkflowAction[],
  enabled: w.enabled,
  createdById: w.createdById,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

const bad = (code: string, message: string) => new BadRequestException({ code, message });

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalog(): WorkflowCatalogDto {
    return workflowCatalog();
  }

  async list(actor: AuthUser, q: { limit: number; cursor?: string }): Promise<Page<WorkflowDto>> {
    const rows = await this.prisma.workflow.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toWorkflowDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  private async load(actor: AuthUser, id: string) {
    const w = await this.prisma.workflow.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!w) throw new NotFoundException('گردش‌کار یافت نشد');
    return w;
  }

  async get(actor: AuthUser, id: string): Promise<WorkflowDto> {
    return toWorkflowDto(await this.load(actor, id));
  }

  private async assertNameFree(actor: AuthUser, name: string, exceptId?: string) {
    const clash = await this.prisma.workflow.findFirst({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'WORKFLOW_NAME_TAKEN',
        message: 'گردش‌کار دیگری با این نام وجود دارد',
      });
    }
  }

  async create(actor: AuthUser, dto: CreateWorkflowRequest, ip?: string): Promise<WorkflowDto> {
    await this.assertNameFree(actor, dto.name);
    // A new workflow is always created disabled; turning it on is a separate, audited step.
    const w = await this.prisma.workflow.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        description: dto.description ?? null,
        triggerType: dto.triggerType,
        conditions: dto.conditions as never,
        actions: dto.actions as never,
        enabled: false,
        createdById: actor.id,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'workflow.created',
      entityType: 'workflow',
      entityId: w.id,
      metadata: { name: w.name, triggerType: w.triggerType },
      ip,
    });
    return toWorkflowDto(w);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateWorkflowRequest,
    ifMatch?: string,
    ip?: string,
  ): Promise<WorkflowDto> {
    const cur = await this.load(actor, id);
    assertIfMatch(ifMatch, cur.updatedAt);
    const merged = {
      triggerType: (dto.triggerType ?? cur.triggerType) as WorkflowDto['triggerType'],
      conditions: (dto.conditions ?? cur.conditions) as WorkflowCondition[],
      actions: (dto.actions ?? cur.actions) as WorkflowAction[],
    };
    const problem = checkWorkflowDefinition(merged);
    if (problem) throw bad('INVALID_WORKFLOW', problem);
    if (dto.name !== undefined && dto.name !== cur.name)
      await this.assertNameFree(actor, dto.name, id);

    const data = {
      name: dto.name,
      description: dto.description,
      triggerType: dto.triggerType,
      conditions: dto.conditions as never,
      actions: dto.actions as never,
    };
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    const written = await this.prisma.workflow.updateMany({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(hasPrecondition(ifMatch) ? unchangedSince(cur.updatedAt) : {}),
      },
      data: clean,
    });
    if (written.count === 0) {
      throw hasPrecondition(ifMatch) ? staleEntity() : new NotFoundException('گردش‌کار یافت نشد');
    }
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'workflow.updated',
      entityType: 'workflow',
      entityId: id,
      metadata: { fields: Object.keys(clean) },
      ip,
    });
    return this.get(actor, id);
  }

  async setEnabled(
    actor: AuthUser,
    id: string,
    enabled: boolean,
    ip?: string,
  ): Promise<WorkflowDto> {
    const cur = await this.load(actor, id);
    if (cur.enabled === enabled) return toWorkflowDto(cur);
    if (enabled) {
      const problem = checkWorkflowDefinition({
        triggerType: cur.triggerType as WorkflowDto['triggerType'],
        conditions: cur.conditions as WorkflowCondition[],
        actions: cur.actions as WorkflowAction[],
      });
      if (problem) throw bad('INVALID_WORKFLOW', problem);
      const active = await this.prisma.workflow.count({
        where: { organizationId: actor.organizationId, deletedAt: null, enabled: true },
      });
      if (active >= WORKFLOW_MAX_ENABLED) {
        throw new ConflictException({
          code: 'TOO_MANY_WORKFLOWS',
          message: `حداکثر ${WORKFLOW_MAX_ENABLED} گردش‌کار فعال مجاز است`,
        });
      }
    }
    await this.prisma.workflow.updateMany({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      data: { enabled },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: enabled ? 'workflow.enabled' : 'workflow.disabled',
      entityType: 'workflow',
      entityId: id,
      ip,
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthUser, id: string, ip?: string): Promise<void> {
    await this.load(actor, id);
    await this.prisma.workflow.updateMany({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      data: { deletedAt: new Date(), enabled: false },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'workflow.deleted',
      entityType: 'workflow',
      entityId: id,
      ip,
    });
  }

  async runs(actor: AuthUser, id: string, q: WorkflowRunListQuery): Promise<Page<WorkflowRunDto>> {
    await this.load(actor, id);
    const rows = await this.prisma.workflowRun.findMany({
      where: { workflowId: id, ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(
      (r): WorkflowRunDto => ({
        id: r.id,
        workflowId: r.workflowId,
        eventId: r.eventId,
        status: r.status as WorkflowRunDto['status'],
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt.toISOString(),
        steps: r.steps as unknown as WorkflowRunStep[],
        error: r.error,
      }),
    );
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }
}
