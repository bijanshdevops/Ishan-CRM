import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationListQuerySchema } from '@ishan/contracts';
import type { z } from 'zod';
import { AuthenticatedOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { NotificationsService } from './notifications.service';

/**
 * Notifications need no permission: every authenticated user has their own inbox and the service
 * scopes everything to the caller's id.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @AuthenticatedOnly()
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(NotificationListQuerySchema))
    q: z.infer<typeof NotificationListQuerySchema>,
  ) {
    return this.notifications.list(actor, q);
  }

  // Static segments before ':id'.
  @Get('unread-count')
  @AuthenticatedOnly()
  unreadCount(@CurrentUser() actor: AuthUser) {
    return this.notifications.unreadCount(actor);
  }

  @Post('read-all')
  @HttpCode(200)
  @AuthenticatedOnly()
  readAll(@CurrentUser() actor: AuthUser) {
    return this.notifications.markAllRead(actor);
  }

  @Post(':id/read')
  @HttpCode(200)
  @AuthenticatedOnly()
  read(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.markRead(actor, id);
  }
}
