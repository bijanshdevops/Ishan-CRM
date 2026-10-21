import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EMAIL_TEST_PER_HOUR,
  type NotificationPreferencesDto,
  type UpdateNotificationPreferences,
} from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { RateLimiter } from '../../common/rate-limiter';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { createSmtpTransport, type MailTransport } from '../../jobs/emails';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

@Injectable()
export class NotificationPreferencesService {
  private readonly testLimiter = new RateLimiter(EMAIL_TEST_PER_HOUR, 60 * 60 * 1000);
  private transport: MailTransport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_TRANSPORT) private readonly injected: MailTransport | null,
  ) {}

  private get available(): boolean {
    return Boolean(this.config.SMTP_HOST);
  }

  async get(actor: AuthUser): Promise<NotificationPreferencesDto> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId: actor.id },
      select: { emailEnabled: true },
    });
    return {
      emailAvailable: this.available,
      emailEnabled: this.available && (pref?.emailEnabled ?? false),
      email: actor.email,
    };
  }

  async update(
    actor: AuthUser,
    input: UpdateNotificationPreferences,
  ): Promise<NotificationPreferencesDto> {
    if (input.emailEnabled && !this.available) {
      throw new UnprocessableEntityException({
        code: 'email_channel_unavailable',
        message: 'ارسال ایمیل در این سامانه پیکربندی نشده است.',
      });
    }
    await this.prisma.notificationPreference.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, emailEnabled: input.emailEnabled },
      update: { emailEnabled: input.emailEnabled },
    });
    return this.get(actor);
  }

  /** Sends a sample message to the caller's own address, synchronously, so SMTP problems show up at once. */
  async sendTest(actor: AuthUser): Promise<{ sent: true }> {
    if (!this.available) {
      throw new UnprocessableEntityException({
        code: 'email_channel_unavailable',
        message: 'ارسال ایمیل در این سامانه پیکربندی نشده است.',
      });
    }
    if (!this.testLimiter.allow(actor.id)) {
      throw new HttpException(
        { code: 'rate_limited', message: 'تعداد ایمیل آزمایشی در ساعت گذشته به سقف رسیده است.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.transport ??= this.injected ?? createSmtpTransport(this.config);
    try {
      await this.transport.sendMail({
        from: this.config.EMAIL_FROM ?? '',
        to: actor.email,
        subject: 'ایمیل آزمایشی ایشان',
        text: 'اگر این پیام را می‌بینید، ارسال ایمیل اعلان‌ها درست کار می‌کند.',
        html: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">اگر این پیام را می‌بینید، ارسال ایمیل اعلان‌ها درست کار می‌کند.</div>',
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'email_send_failed',
        message: 'ارسال ایمیل آزمایشی ناموفق بود. تنظیمات SMTP سرور را بررسی کنید.',
      });
    }
    return { sent: true };
  }
}
