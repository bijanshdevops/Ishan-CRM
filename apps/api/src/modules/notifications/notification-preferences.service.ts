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
import { MailerService } from './mailer.service';

@Injectable()
export class NotificationPreferencesService {
  private readonly testLimiter = new RateLimiter(EMAIL_TEST_PER_HOUR, 60 * 60 * 1000);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: MailerService,
  ) {}

  private get available(): boolean {
    return this.mailer.available;
  }

  async get(actor: AuthUser): Promise<NotificationPreferencesDto> {
    const [pref, user] = await Promise.all([
      this.prisma.notificationPreference.findUnique({
        where: { userId: actor.id },
        select: { emailEnabled: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: { emailVerifiedAt: true },
      }),
    ]);
    const verified = user.emailVerifiedAt !== null;
    return {
      emailAvailable: this.available,
      emailVerified: verified,
      emailEnabled: this.available && verified && (pref?.emailEnabled ?? false),
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
    if (input.emailEnabled) await this.requireVerified(actor);
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
    await this.requireVerified(actor);
    if (!this.testLimiter.allow(actor.id)) {
      throw new HttpException(
        { code: 'rate_limited', message: 'تعداد ایمیل آزمایشی در ساعت گذشته به سقف رسیده است.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      await this.mailer.send({
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

  private async requireVerified(actor: AuthUser): Promise<void> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { emailVerifiedAt: true },
    });
    if (!u.emailVerifiedAt) {
      throw new UnprocessableEntityException({
        code: 'email_not_verified',
        message: 'ابتدا نشانی ایمیل خود را تأیید کنید.',
      });
    }
  }
}
