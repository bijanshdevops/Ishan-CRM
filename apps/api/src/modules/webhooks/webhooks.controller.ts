import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateWebhookRequestSchema,
  PERMISSIONS,
  UpdateWebhookRequestSchema,
  WebhookDeliveryListQuerySchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { WebhooksService } from './webhooks.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();
const ListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  // Static segments must be declared before ':id'.
  @Get('catalog')
  @RequirePermission(PERMISSIONS.WEBHOOKS_READ)
  catalog() {
    return this.webhooks.catalog();
  }

  @Post('deliveries/:id/redeliver')
  @HttpCode(201)
  @RequirePermission(PERMISSIONS.WEBHOOKS_WRITE)
  redeliver(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.redeliver(actor, id, req.ip);
  }

  @Get()
  @RequirePermission(PERMISSIONS.WEBHOOKS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: Infer<typeof ListQuerySchema>,
  ) {
    return this.webhooks.list(actor, q);
  }

  @Post()
  @RequirePermission(PERMISSIONS.WEBHOOKS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateWebhookRequestSchema))
    body: Infer<typeof CreateWebhookRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.create(actor, body, req.ip);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.WEBHOOKS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.webhooks.get(actor, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.WEBHOOKS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateWebhookRequestSchema))
    body: Infer<typeof UpdateWebhookRequestSchema>,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.update(actor, id, body, ifMatch, req.ip);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.WEBHOOKS_WRITE)
  enable(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.setEnabled(actor, id, true, req.ip);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.WEBHOOKS_WRITE)
  disable(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.setEnabled(actor, id, false, req.ip);
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.WEBHOOKS_WRITE)
  rotateSecret(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.rotateSecret(actor, id, req.ip);
  }

  @Post(':id/test')
  @HttpCode(202)
  @RequirePermission(PERMISSIONS.WEBHOOKS_WRITE)
  test(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.webhooks.test(actor, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.WEBHOOKS_DELETE)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    await this.webhooks.remove(actor, id, req.ip);
  }

  @Get(':id/deliveries')
  @RequirePermission(PERMISSIONS.WEBHOOKS_READ)
  deliveries(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(WebhookDeliveryListQuerySchema))
    q: Infer<typeof WebhookDeliveryListQuerySchema>,
  ) {
    return this.webhooks.deliveries(actor, id, q);
  }
}
