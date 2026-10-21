import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UpdateNotificationPreferencesSchema } from '@ishan/contracts';
import type { z } from 'zod';
import { AuthenticatedOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { EmailVerificationService } from './email-verification.service';
import { NotificationPreferencesService } from './notification-preferences.service';

/** Personal settings: no permission needed, everything is scoped to the caller. */
@ApiTags('account')
@Controller('account')
export class NotificationPreferencesController {
  constructor(
    private readonly prefs: NotificationPreferencesService,
    private readonly verification: EmailVerificationService,
  ) {}

  @Get('notification-preferences')
  @AuthenticatedOnly()
  get(@CurrentUser() actor: AuthUser) {
    return this.prefs.get(actor);
  }

  @Put('notification-preferences')
  @AuthenticatedOnly()
  update(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesSchema))
    body: z.infer<typeof UpdateNotificationPreferencesSchema>,
  ) {
    return this.prefs.update(actor, body);
  }

  @Post('notification-email/test')
  @HttpCode(200)
  @AuthenticatedOnly()
  test(@CurrentUser() actor: AuthUser) {
    return this.prefs.sendTest(actor);
  }

  @Post('notification-email/verify-request')
  @HttpCode(200)
  @AuthenticatedOnly()
  verifyRequest(@CurrentUser() actor: AuthUser) {
    return this.verification.request(actor);
  }
}
