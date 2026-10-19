import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ConvertLeadRequestSchema,
  CreateDealRequestSchema,
  CreateLeadRequestSchema,
  CreateStageRequestSchema,
  DealListQuerySchema,
  LeadListQuerySchema,
  MoveDealRequestSchema,
  PERMISSIONS,
  ReorderStagesRequestSchema,
  UpdateDealRequestSchema,
  UpdateLeadRequestSchema,
  UpdateStageRequestSchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { DealsService } from './deals.service';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.LEADS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(LeadListQuerySchema)) q: Infer<typeof LeadListQuerySchema>,
  ) {
    return this.leads.list(actor, q);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.LEADS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.leads.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.LEADS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateLeadRequestSchema))
    body: Infer<typeof CreateLeadRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.leads.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.LEADS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateLeadRequestSchema))
    body: Infer<typeof UpdateLeadRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.leads.update(actor, id, body, req.ip);
  }

  @Post(':id/convert')
  @RequirePermission(PERMISSIONS.LEADS_CONVERT)
  @HttpCode(200)
  convert(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(ConvertLeadRequestSchema))
    body: Infer<typeof ConvertLeadRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.leads.convert(actor, id, body, req.ip);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.LEADS_WRITE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.leads.remove(actor, id, req.ip);
  }
}

@ApiTags('deals')
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.DEALS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(DealListQuerySchema)) q: Infer<typeof DealListQuerySchema>,
  ) {
    return this.deals.list(actor, q);
  }

  @Get('funnel')
  @RequirePermission(PERMISSIONS.DEALS_READ)
  funnel(@CurrentUser() actor: AuthUser) {
    return this.deals.funnel(actor);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.DEALS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.deals.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.DEALS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateDealRequestSchema))
    body: Infer<typeof CreateDealRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.deals.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.DEALS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateDealRequestSchema))
    body: Infer<typeof UpdateDealRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.deals.update(actor, id, body, req.ip);
  }

  @Post(':id/move')
  @RequirePermission(PERMISSIONS.DEALS_WRITE)
  @HttpCode(200)
  move(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(MoveDealRequestSchema)) body: Infer<typeof MoveDealRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.deals.move(actor, id, body.stageId, body.lostReason, req.ip);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.DEALS_DELETE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.deals.remove(actor, id, req.ip);
  }
}

@ApiTags('pipeline')
@Controller('pipeline/stages')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get()
  @RequirePermission(PERMISSIONS.DEALS_READ)
  list(@CurrentUser() actor: AuthUser) {
    return this.pipeline.list(actor);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateStageRequestSchema))
    body: Infer<typeof CreateStageRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.pipeline.create(actor, body, req.ip);
  }

  @Put('order')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  reorder(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(ReorderStagesRequestSchema))
    body: Infer<typeof ReorderStagesRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.pipeline.reorder(actor, body.stageIds, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateStageRequestSchema))
    body: Infer<typeof UpdateStageRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.pipeline.update(actor, id, body, req.ip);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.pipeline.remove(actor, id, req.ip);
  }
}
