import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EMAIL_VERIFICATION_TTL_HOURS, EMAIL_VERIFY_REQUESTS_PER_HOUR } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { RateLimiter } from '../../common/rate-limiter';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../auth/crypto.service';
import { MailerService } from './mailer.service';

const HOUR_MS = 60 * 60 * 1000;
const invalid = () =>
  new BadRequestException({
    code: 'invalid_token',
    message: 'پیوند تأیید نامعتبر است یا منقضی شده. یک پیوند تازه درخواست کنید.',
  });

@Injectable()
export class EmailVerificationService {
  private readonly requestLimiter = new RateLimiter(EMAIL_VERIFY_REQUESTS_PER_HOUR, HOUR_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Sends a fresh link to the caller's own address; older unused links stop working. */
  async request(actor: AuthUser, now = new Date()): Promise<{ sent: true }> {
    if (!this.mailer.available) {
      throw new UnprocessableEntityException({
        code: 'email_channel_unavailable',
        message: 'ارسال ایمیل در این سامانه پیکربندی نشده است.',
      });
    }
    const user = await this.prisma.user.findFirstOrThrow({
      where: { id: actor.id, status: 'ACTIVE', deletedAt: null },
      select: { email: true, emailVerifiedAt: true },
    });
    if (user.emailVerifiedAt) {
      throw new UnprocessableEntityException({
        code: 'email_already_verified',
        message: 'نشانی ایمیل شما قبلاً تأیید شده است.',
      });
    }
    if (!this.requestLimiter.allow(actor.id)) {
      throw new HttpException(
        {
          code: 'rate_limited',
          message: 'تعداد درخواست پیوند تأیید در ساعت گذشته به سقف رسیده است.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const token = randomBytes(32).toString('base64url');
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId: actor.id, usedAt: null },
        data: { usedAt: now },
      });
      return tx.emailVerificationToken.create({
        data: {
          userId: actor.id,
          tokenHash: CryptoService.sha256Hex(token),
          email: user.email,
          expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * HOUR_MS),
        },
        select: { id: true },
      });
    });
    const link = `${(this.config.APP_BASE_URL ?? '').replace(/\/+$/, '')}/verify-email?token=${token}`;
    try {
      await this.mailer.send({
        to: user.email,
        subject: 'تأیید نشانی ایمیل در ایشان',
        text: `برای تأیید نشانی ایمیل خود پیوند زیر را باز کنید (۲۴ ساعت اعتبار دارد):\n\n${link}\n\nاگر شما درخواست نکرده‌اید، این پیام را نادیده بگیرید.`,
        html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9"><p>برای تأیید نشانی ایمیل خود روی دکمه‌ی زیر بزنید (۲۴ ساعت اعتبار دارد).</p><p><a href="${link}" style="display:inline-block;background:#1f5eff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">تأیید ایمیل</a></p><p style="color:#6b7280;font-size:12px">اگر شما درخواست نکرده‌اید، این پیام را نادیده بگیرید.</p></div>`,
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
    } catch {
      await this.prisma.emailVerificationToken
        .delete({ where: { id: created.id } })
        .catch(() => undefined);
      throw new ServiceUnavailableException({
        code: 'email_send_failed',
        message: 'ارسال ایمیل ناموفق بود. تنظیمات SMTP سرور را بررسی کنید.',
      });
    }
    return { sent: true };
  }

  /** Consumes a link. Every failure looks the same so the response reveals nothing about the token. */
  async verify(
    token: string,
    ip: string | undefined,
    now = new Date(),
  ): Promise<{ verified: true }> {
    const row = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: CryptoService.sha256Hex(token) },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: { id: true, organizationId: true, email: true, status: true, deletedAt: true },
        },
      },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt <= now ||
      row.user.deletedAt ||
      row.user.status !== 'ACTIVE' ||
      row.user.email !== row.email
    ) {
      throw invalid();
    }
    // The conditional update is the single-use gate: a concurrent second click matches nothing.
    const used = await this.prisma.emailVerificationToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (used.count === 0) throw invalid();
    await this.prisma.user.update({
      where: { id: row.user.id },
      data: { emailVerifiedAt: now },
    });
    await this.audit.record({
      organizationId: row.user.organizationId,
      actorId: row.user.id,
      action: 'user.email_verified',
      entityType: 'user',
      entityId: row.user.id,
      ip,
    });
    return { verified: true };
  }
}
