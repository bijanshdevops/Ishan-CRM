import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser) {
    const rows = await this.prisma.team.findMany({
      where: { organizationId: actor.organizationId, deletedAt: null },
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      memberCount: t._count.members,
    }));
  }

  private async findTeam(actor: AuthUser, id: string) {
    const team = await this.prisma.team.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('تیم یافت نشد');
    return team;
  }

  async get(actor: AuthUser, id: string) {
    const team = await this.prisma.team.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: { members: { include: { user: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!team) throw new NotFoundException('تیم یافت نشد');
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      members: team.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      })),
    };
  }

  async create(actor: AuthUser, dto: { name: string; description?: string }, ip?: string) {
    if (
      await this.prisma.team.findFirst({
        where: { organizationId: actor.organizationId, name: dto.name },
      })
    ) {
      throw new ConflictException({ code: 'TEAM_NAME_TAKEN', message: 'نام تیم تکراری است' });
    }
    const team = await this.prisma.team.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        description: dto.description ?? null,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'team.created',
      entityType: 'team',
      entityId: team.id,
      metadata: { name: team.name },
      ip,
    });
    return { id: team.id, name: team.name, description: team.description, memberCount: 0 };
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: { name?: string; description?: string },
    ip?: string,
  ) {
    await this.findTeam(actor, id);
    if (dto.name) {
      const clash = await this.prisma.team.findFirst({
        where: { organizationId: actor.organizationId, name: dto.name, id: { not: id } },
      });
      if (clash)
        throw new ConflictException({ code: 'TEAM_NAME_TAKEN', message: 'نام تیم تکراری است' });
    }
    const team = await this.prisma.team.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'team.updated',
      entityType: 'team',
      entityId: id,
      metadata: { changes: dto },
      ip,
    });
    return { id: team.id, name: team.name, description: team.description };
  }

  async remove(actor: AuthUser, id: string, ip?: string): Promise<void> {
    const team = await this.findTeam(actor, id);
    // Free the name for reuse while keeping the row for history.
    await this.prisma.team.update({
      where: { id },
      data: { deletedAt: new Date(), name: `${team.name}#deleted-${id.slice(0, 8)}` },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'team.deleted',
      entityType: 'team',
      entityId: id,
      metadata: { name: team.name },
      ip,
    });
  }

  async addMember(
    actor: AuthUser,
    teamId: string,
    dto: { userId: string; role: 'MEMBER' | 'LEAD' },
    ip?: string,
  ): Promise<void> {
    await this.findTeam(actor, teamId);
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    await this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId: dto.userId } },
      create: { teamId, userId: dto.userId, role: dto.role },
      update: { role: dto.role },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'team.member_set',
      entityType: 'team',
      entityId: teamId,
      metadata: { userId: dto.userId, role: dto.role },
      ip,
    });
  }

  async removeMember(actor: AuthUser, teamId: string, userId: string, ip?: string): Promise<void> {
    await this.findTeam(actor, teamId);
    const res = await this.prisma.teamMember.deleteMany({ where: { teamId, userId } });
    if (res.count === 0) throw new NotFoundException('عضو یافت نشد');
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'team.member_removed',
      entityType: 'team',
      entityId: teamId,
      metadata: { userId },
      ip,
    });
  }
}
