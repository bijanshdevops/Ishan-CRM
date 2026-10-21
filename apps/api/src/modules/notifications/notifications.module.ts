import { Global, Module } from '@nestjs/common';
import { EmailVerificationController } from './email-verification.controller';
import { EmailVerificationService } from './email-verification.service';
import { MAIL_TRANSPORT, MailerService } from './mailer.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [
    NotificationsController,
    NotificationPreferencesController,
    EmailVerificationController,
  ],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    EmailVerificationService,
    MailerService,
    { provide: MAIL_TRANSPORT, useValue: null },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
