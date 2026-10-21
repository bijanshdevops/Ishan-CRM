import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { createSmtpTransport, type MailMessage, type MailTransport } from '../../jobs/emails';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Synchronous sending for user-triggered mail (test and verification e-mails). */
@Injectable()
export class MailerService {
  private transport: MailTransport | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_TRANSPORT) private readonly injected: MailTransport | null,
  ) {}

  get available(): boolean {
    return Boolean(this.config.SMTP_HOST);
  }

  async send(message: Omit<MailMessage, 'from'>): Promise<void> {
    this.transport ??= this.injected ?? createSmtpTransport(this.config);
    await this.transport.sendMail({ ...message, from: this.config.EMAIL_FROM ?? '' });
  }
}
