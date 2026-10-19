import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../common/decorators';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { CryptoService } from './crypto.service';

const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get idleSeconds(): number {
    return this.config.SESSION_IDLE_MINUTES * 60;
  }

  async create(userId: string, ip?: string, userAgent?: string) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: CryptoService.sha256Hex(token),
        ip: ip ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(now + this.idleSeconds * 1000),
        absoluteExpiresAt: new Date(now + this.config.SESSION_ABSOLUTE_DAYS * 86_400_000),
      },
    });
    return { token, session };
  }

  /** Resolves a cookie token to the authenticated user, sliding the idle expiry. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: CryptoService.sha256Hex(token) },
      include: { user: { include: { role: true } } },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.absoluteExpiresAt.getTime() <= now ||
      session.user.status !== 'ACTIVE' ||
      session.user.deletedAt
    ) {
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const idleExpiry = now + this.idleSeconds * 1000;
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: new Date(now),
          expiresAt: new Date(Math.min(idleExpiry, session.absoluteExpiresAt.getTime())),
        },
      });
    }
    const { user } = session;
    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      roleKey: user.role.key,
      roleName: user.role.name,
      permissions: user.role.permissions,
      sessionId: session.id,
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: user.mfaEnabled,
    };
  }

  async revoke(sessionId: string, userId: string): Promise<boolean> {
    const res = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count > 0;
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  listActive(userId: string) {
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        absoluteExpiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
