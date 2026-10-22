import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateSuppressionSchema,
  PERMISSIONS,
  SaveCampaignSendingSchema,
  StartCampaignSendingSchema,
  UnsubscribeSchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentUser, Public, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { RateLimitService } from '../../infra/rate-limit.service';
import { CampaignSendingService } from './campaign-sending.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();

@ApiTags('campaign-sending')
@Controller()
export class CampaignSendingController {
  constructor(private readonly sending: CampaignSendingService) {}

  @Get('campaigns/:id/sending')
  @RequirePermission(PERMISSIONS.CAMPAIGNS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.sending.get(actor, id);
  }

  @Put('campaigns/:id/sending')
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  save(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(SaveCampaignSendingSchema))
    body: Infer<typeof SaveCampaignSendingSchema>,
  ) {
    return this.sending.save(actor, id, body);
  }

  @Post('campaigns/:id/sending/preview')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  preview(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.sending.preview(actor, id);
  }

  @Post('campaigns/:id/sending/test')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  test(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.sending.test(actor, id);
  }

  @Post('campaigns/:id/sending/start')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.CAMPAIGNS_SEND)
  start(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(StartCampaignSendingSchema))
    body: Infer<typeof StartCampaignSendingSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.sending.start(actor, id, body, req.ip);
  }

  @Post('campaigns/:id/sending/cancel')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.CAMPAIGNS_SEND)
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.sending.cancel(actor, id, req.ip);
  }

  @Get('marketing/suppressions')
  @RequirePermission(PERMISSIONS.CAMPAIGNS_READ)
  suppressions(@CurrentUser() actor: AuthUser) {
    return this.sending.listSuppressions(actor);
  }

  @Post('marketing/suppressions')
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  addSuppression(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateSuppressionSchema))
    body: Infer<typeof CreateSuppressionSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.sending.addSuppression(actor, body, req.ip);
  }

  @Delete('marketing/suppressions/:id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  removeSuppression(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.sending.removeSuppression(actor, id, req.ip);
  }
}

/** Public on purpose: the signed token is the credential (ADR 0015). */
@ApiTags('public')
@Controller('public')
export class UnsubscribeController {
  constructor(
    private readonly sending: CampaignSendingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Token in the body (web page) or in the query (RFC 8058 one-click, whose form body is ignored). */
  @Post('unsubscribe')
  @Public()
  @HttpCode(200)
  async unsubscribe(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
    @Query('token') queryToken?: string,
  ) {
    if (!(await this.rateLimit.allow(`unsubscribe:ip:${req.ip}`, 30, 60_000))) {
      throw new HttpException(
        { code: 'rate_limited', message: 'تلاش‌های بیش از حد. کمی بعد دوباره امتحان کنید.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const bodyToken = (body as { token?: unknown } | null | undefined)?.token;
    const parsed = UnsubscribeSchema.safeParse({ token: queryToken ?? bodyToken });
    if (!parsed.success) {
      throw new HttpException(
        { code: 'invalid_token', message: 'پیوند لغو اشتراک نامعتبر است.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.sending.unsubscribe(parsed.data.token, req.ip);
  }
}
