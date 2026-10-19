import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { LoginRequest } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toSessionUserDto } from '../users/user.mapper';
import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

export type LoginResult =
  | { status: 'ok'; token: string; user: ReturnType<typeof toSessionUserDto> }
  | { status: 'mfa_required' };

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

const INVALID = 'ایمیل یا گذرواژه نادرست است';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(dto: LoginRequest, client: ClientInfo): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      include: { role: true },
    });

    if (!user) {
      await this.passwords.verifyDummy(dto.password);
      throw new UnauthorizedException(INVALID);
    }

    const now = Date.now();
    const locked = user.lockedUntil !== null && user.lockedUntil.getTime() > now;
    const passwordOk = await this.passwords.verify(user.passwordHash, dto.password);

    if (locked || user.status !== 'ACTIVE' || !passwordOk) {
      if (!locked && user.status === 'ACTIVE') await this.registerFailure(user, client, 'password');
      else
        await this.audit.record({
          organizationId: user.organizationId,
          actorId: user.id,
          action: 'auth.login_rejected',
          entityType: 'user',
          entityId: user.id,
          metadata: { reason: locked ? 'locked' : 'disabled' },
          ip: client.ip,
        });
      throw new UnauthorizedException(INVALID);
    }

    if (user.mfaEnabled) {
      if (!dto.totpCode) return { status: 'mfa_required' };
      const secret = this.crypto.decrypt(user.mfaSecretEnc ?? '');
      if (!this.totp.verify(secret, dto.totpCode)) {
        await this.registerFailure(user, client, 'totp');
        throw new UnauthorizedException(INVALID);
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const { token } = await this.sessions.create(user.id, client.ip, client.userAgent);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ip: client.ip,
    });
    return { status: 'ok', token, user: toSessionUserDto(user) };
  }

  private async registerFailure(
    user: { id: string; organizationId: string; failedLoginCount: number },
    client: ClientInfo,
    factor: 'password' | 'totp',
  ): Promise<void> {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= this.config.LOGIN_MAX_FAILURES;
    await this.prisma.user.update({
      where: { id: user.id },
      data: lock
        ? {
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + this.config.LOGIN_LOCK_MINUTES * 60_000),
          }
        : { failedLoginCount: failures },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: lock ? 'auth.lockout' : 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      metadata: { factor },
      ip: client.ip,
    });
  }

  async me(user: AuthUser) {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { role: true },
    });
    return toSessionUserDto(row);
  }

  async logout(user: AuthUser, client: ClientInfo): Promise<void> {
    await this.sessions.revoke(user.sessionId, user.id);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.logout',
      entityType: 'user',
      entityId: user.id,
      ip: client.ip,
    });
  }

  async changePassword(
    user: AuthUser,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(row.passwordHash, currentPassword))) {
      throw new BadRequestException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'گذرواژه فعلی نادرست است',
      });
    }
    if (
      currentPassword === newPassword ||
      newPassword.toLowerCase().includes(row.email.split('@')[0]!.toLowerCase())
    ) {
      throw new BadRequestException({ code: 'WEAK_PASSWORD', message: 'گذرواژه جدید مجاز نیست' });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    await this.sessions.revokeAllForUser(user.id, user.sessionId);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: user.id,
      ip: client.ip,
    });
  }

  async mfaSetup(user: AuthUser) {
    if (user.mfaEnabled)
      throw new BadRequestException({ code: 'MFA_ALREADY_ENABLED', message: 'MFA فعال است' });
    const secret = this.totp.generateSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: this.crypto.encrypt(secret) },
    });
    return { secret, otpauthUrl: this.totp.otpauthUrl(secret, user.email) };
  }

  async mfaEnable(user: AuthUser, code: string, client: ClientInfo): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (row.mfaEnabled || !row.mfaSecretEnc) {
      throw new BadRequestException({
        code: 'MFA_NOT_PENDING',
        message: 'ابتدا راه‌اندازی MFA را آغاز کنید',
      });
    }
    if (!this.totp.verify(this.crypto.decrypt(row.mfaSecretEnc), code)) {
      throw new BadRequestException({ code: 'INVALID_CODE', message: 'کد نادرست است' });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.mfa_enabled',
      entityType: 'user',
      entityId: user.id,
      ip: client.ip,
    });
  }

  async mfaDisable(
    user: AuthUser,
    password: string,
    code: string,
    client: ClientInfo,
  ): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.mfaEnabled || !row.mfaSecretEnc) {
      throw new BadRequestException({ code: 'MFA_NOT_ENABLED', message: 'MFA فعال نیست' });
    }
    const ok =
      (await this.passwords.verify(row.passwordHash, password)) &&
      this.totp.verify(this.crypto.decrypt(row.mfaSecretEnc), code);
    if (!ok)
      throw new ForbiddenException({
        code: 'INVALID_CREDENTIALS',
        message: 'گذرواژه یا کد نادرست است',
      });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecretEnc: null },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.mfa_disabled',
      entityType: 'user',
      entityId: user.id,
      ip: client.ip,
    });
  }
}
