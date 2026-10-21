import { Global, Module } from '@nestjs/common';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { MAIL_TRANSPORT, NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    { provide: MAIL_TRANSPORT, useValue: null },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
