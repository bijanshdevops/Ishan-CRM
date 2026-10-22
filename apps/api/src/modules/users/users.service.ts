import { assertIfMatch, assertWritten, casWhere } from '../../common/etag';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CreateUserRequest, ListQuery, Page, UserDto } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { buildEmailChangeNotice } from '../notifications/email-change-notice';
import { MailerService } from '../notifications/mailer.service';
import { toUserDto } from './user.mapper';

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
const emailTaken = () =>
  new ConflictException({ code: 'EMAIL_TAKEN', message: 'این ایمیل قبلاً ثبت شده است' });

interface UpdateInput {
  name?: string;
  email?: string;
  roleId?: string;
  status?: 'ACTIVE' | 'DISABLED';
}

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
  ) {}

  async list(actor: AuthUser, query: ListQuery): Promise<Page<UserDto>> {
    const rows = await this.prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(query.q
          ? {
              OR: [
                { email: { contains: query.q.toLowerCase() } },
                { name: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: { role: true },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map(toUserDto);
    return { items, nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null };
  }

  /** Active users inside the actor's data scope (everyone for ALL), id and name only. */
  async assignable(actor: AuthUser): Promise<{ items: Array<{ id: string; name: string }> }> {
    const items = await this.prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(actor.scopeUserIds === null ? {} : { id: { in: actor.scopeUserIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return { items };
  }

  async get(actor: AuthUser, id: string): Promise<UserDto> {
    const row = await this.prisma.user.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: { role: true },
    });
    if (!row) throw new NotFoundException('کاربر یافت نشد');
    return toUserDto(row);
  }

  async create(actor: AuthUser, dto: CreateUserRequest, ip?: string): Promise<UserDto> {
    const role = await this.prisma.role.findFirst({
      where: { id: dto.roleId, organizationId: actor.organizationId },
    });
    if (!role) throw new BadRequestException('نقش نامعتبر است');
    const exists = await this.prisma.user.findFirst({
      where: { organizationId: actor.organizationId, email: dto.email },
    });
    if (exists)
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'این ایمیل قبلاً ثبت شده است' });

    const row = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        roleId: role.id,
        email: dto.email,
        name: dto.name,
        passwordHash: await this.passwords.hash(dto.password),
        mustChangePassword: dto.mustChangePassword,
      },
      include: { role: true },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'user.created',
      entityType: 'user',
      entityId: row.id,
      metadata: { email: row.email, role: role.key },
      ip,
    });
    return toUserDto(row);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateInput,
    ip?: string,
    ifMatch?: string,
  ): Promise<UserDto> {
    const target = await this.prisma.user.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: { role: true },
    });
    if (!target) throw new NotFoundException('کاربر یافت نشد');
    assertIfMatch(ifMatch, target.updatedAt);

    let newRoleKey = target.role.key;
    if (dto.roleId && dto.roleId !== target.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: dto.roleId, organizationId: actor.organizationId },
      });
      if (!role) throw new BadRequestException('نقش نامعتبر است');
      newRoleKey = role.key;
    }
    const willDisable = dto.status === 'DISABLED' && target.status === 'ACTIVE';
    if (willDisable && target.id === actor.id) {
      throw new BadRequestException({
        code: 'CANNOT_DISABLE_SELF',
        message: 'نمی‌توانید حساب خودتان را غیرفعال کنید',
      });
    }
    const losesAdmin = target.role.key === 'admin' && (newRoleKey !== 'admin' || willDisable);
    if (losesAdmin && target.status === 'ACTIVE')
      await this.assertAnotherAdmin(actor.organizationId, target.id);

    const emailChanged = dto.email !== undefined && dto.email !== target.email;
    if (emailChanged) {
      if (target.id === actor.id) {
        throw new BadRequestException({
          code: 'CANNOT_CHANGE_OWN_EMAIL',
          message: 'نشانی ایمیل خودتان را مدیر دیگری باید تغییر دهد',
        });
      }
      // Includes soft-deleted rows: the unique index (organization, email) does too.
      const clash = await this.prisma.user.findFirst({
        where: { organizationId: actor.organizationId, email: dto.email, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw emailTaken();
    }

    let written;
    try {
      written = await this.prisma.user.updateMany({
        where: casWhere(id, ifMatch, target.updatedAt),
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          // A new address is unproven until its owner clicks a link sent there (ADR 0014).
          ...(emailChanged ? { email: dto.email, emailVerifiedAt: null } : {}),
          ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
    } catch (e) {
      // Lost a race for the address between the check above and the write.
      if (isUniqueViolation(e)) throw emailTaken();
      throw e;
    }
    assertWritten(written.count, ifMatch, new NotFoundException('کاربر یافت نشد'));
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { role: true },
    });
    if (emailChanged) {
      // Links sent to the old address must not verify the new one (the verify step also checks).
      await this.prisma.emailVerificationToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'user.email_changed',
        entityType: 'user',
        entityId: id,
        metadata: { from: target.email, to: dto.email },
        ip,
      });
      await this.tellOldAddress(target.email, dto.email as string);
    }
    if (willDisable || emailChanged || (dto.roleId && dto.roleId !== target.roleId)) {
      await this.sessions.revokeAllForUser(id);
    }
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: { changes: dto },
      ip,
    });
    return toUserDto(row);
  }

  /**
   * Best effort: the change is already done and audited, so a missing or failing mail channel must
   * not undo or fail it. The outcome is logged without the addresses.
   */
  private async tellOldAddress(oldEmail: string, newEmail: string): Promise<void> {
    if (!this.mailer.available) return;
    try {
      await this.mailer.send(buildEmailChangeNotice({ oldEmail, newEmail }));
    } catch {
      this.log.warn('could not send the e-mail change notice to the previous address');
    }
  }

  async resetPassword(
    actor: AuthUser,
    id: string,
    newPassword: string,
    ip?: string,
  ): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!target) throw new NotFoundException('کاربر یافت نشد');
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: id,
      ip,
    });
  }

  private async assertAnotherAdmin(organizationId: string, exceptUserId: string): Promise<void> {
    const others = await this.prisma.user.count({
      where: {
        organizationId,
        id: { not: exceptUserId },
        status: 'ACTIVE',
        deletedAt: null,
        role: { key: 'admin' },
      },
    });
    if (others === 0) {
      throw new BadRequestException({
        code: 'LAST_ADMIN',
        message: 'حداقل یک مدیر فعال باید باقی بماند',
      });
    }
  }
}
