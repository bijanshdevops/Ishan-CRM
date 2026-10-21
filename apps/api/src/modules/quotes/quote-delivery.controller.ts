import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, SendQuoteEmailSchema } from '@ishan/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { QuoteDeliveryService } from './quote-delivery.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();

@ApiTags('quotes')
@Controller('quotes')
export class QuoteDeliveryController {
  constructor(private readonly delivery: QuoteDeliveryService) {}

  @Get(':id/pdf')
  @RequirePermission(PERMISSIONS.QUOTES_READ)
  async pdf(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { filename, data } = await this.delivery.pdf(actor, id);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Cache-Control', 'no-store');
    return new StreamableFile(data);
  }

  @Get(':id/email-options')
  @RequirePermission(PERMISSIONS.QUOTES_WRITE)
  options(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.delivery.options(actor, id);
  }

  @Get(':id/emails')
  @RequirePermission(PERMISSIONS.QUOTES_READ)
  list(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.delivery.list(actor, id);
  }

  @Post(':id/emails')
  @HttpCode(202)
  @RequirePermission(PERMISSIONS.QUOTES_WRITE)
  send(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(SendQuoteEmailSchema)) body: Infer<typeof SendQuoteEmailSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.delivery.send(actor, id, body, req.ip);
  }

  @Post(':id/emails/:emailId/retry')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.QUOTES_WRITE)
  retry(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('emailId', uuid()) emailId: string,
  ) {
    return this.delivery.retry(actor, id, emailId);
  }
}
