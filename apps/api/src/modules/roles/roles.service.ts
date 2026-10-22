import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ALL_PERMISSIONS, isPermission } from '@ishan/contracts';
import type { DataScope } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  dataScope: string;
}

const toDto = (r: RoleRow, userCount?: number) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  permissions: r.permissions,
  dataScope: r.dataScope,
  ...(userCount !== undefined ? { userCount } : {}),
});

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalog() {
    return { permissions: ALL_PERMISSIONS };
  }

  async list(actor: AuthUser) {
    const rows = await this.prisma.role.findMany({
      where: { organizationId: actor.organizationId },
      include: { _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
    });
    return rows.map((r) => toDto(r, r._count.users));
  }

  private validatePermissions(perms: string[]): string[] {
    const unique = [...new Set(perms)];
    const bad = unique.filter((p) => !isPermission(p));
    if (bad.length) {
      throw new BadRequestException({ message: 'مجوز نامعتبر', details: bad });
    }
    return unique;
  }

  async create(
    actor: AuthUser,
    dto: {
      key: string;
      name: string;
      description?: string;
      permissions: string[];
      dataScope?: DataScope;
    },
    ip?: string,
  ) {
    const perms = this.validatePermissions(dto.permissions);
    if (
      await this.prisma.role.findFirst({
        where: { organizationId: actor.organizationId, key: dto.key },
      })
    ) {
      throw new ConflictException({ code: 'ROLE_KEY_TAKEN', message: 'کلید نقش تکراری است' });
    }
    const row = await this.prisma.role.create({
      data: {
        organizationId: actor.organizationId,
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        permissions: perms,
        dataScope: dto.dataScope ?? 'ALL',
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'role.created',
      entityType: 'role',
      entityId: row.id,
      metadata: { key: row.key, permissions: perms, dataScope: row.dataScope },
      ip,
    });
    return toDto(row);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: {
      name?: string;
      description?: string;
      permissions?: string[];
      dataScope?: DataScope;
    },
    ip?: string,
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!role) throw new NotFoundException('نقش یافت نشد');
    if (role.isSystem) {
      // System roles keep their name and permissions; only the data scope is adjustable (not admin's).
      const onlyScope =
        dto.dataScope !== undefined &&
        dto.name === undefined &&
        dto.description === undefined &&
        dto.permissions === undefined;
      if (!onlyScope) {
        throw new BadRequestException({
          code: 'SYSTEM_ROLE_IMMUTABLE',
          message: 'نقش‌های سیستمی قابل ویرایش نیستند',
        });
      }
      if (role.key === 'admin' && dto.dataScope !== 'ALL') {
        throw new BadRequestException({
          code: 'ADMIN_SCOPE_LOCKED',
          message: 'دامنه‌ی دسترسی نقش مدیر سیستم تغییر نمی‌کند',
        });
      }
    }
    const perms = dto.permissions ? this.validatePermissions(dto.permissions) : undefined;
    const row = await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(perms ? { permissions: perms } : {}),
        ...(dto.dataScope !== undefined ? { dataScope: dto.dataScope } : {}),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'role.updated',
      entityType: 'role',
      entityId: id,
      metadata: { changes: { ...dto, permissions: perms } },
      ip,
    });
    return toDto(row);
  }

  async remove(actor: AuthUser, id: string, ip?: string): Promise<void> {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('نقش یافت نشد');
    if (role.isSystem) {
      throw new BadRequestException({
        code: 'SYSTEM_ROLE_IMMUTABLE',
        message: 'نقش‌های سیستمی قابل حذف نیستند',
      });
    }
    if (role._count.users > 0) {
      throw new ConflictException({
        code: 'ROLE_IN_USE',
        message: 'این نقش به کاربران اختصاص داده شده است',
      });
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'role.deleted',
      entityType: 'role',
      entityId: id,
      metadata: { key: role.key },
      ip,
    });
  }
}
