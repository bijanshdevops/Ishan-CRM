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
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CampaignListQuerySchema,
  CreateCampaignRequestSchema,
  CreateLeadSourceRequestSchema,
  PERMISSIONS,
  UpdateCampaignRequestSchema,
  UpdateLeadSourceRequestSchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CampaignsService } from './campaigns.service';
import { LeadSourcesService } from './lead-sources.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();

@ApiTags('lead-sources')
@Controller('lead-sources')
export class LeadSourcesController {
  constructor(private readonly sources: LeadSourcesService) {}

  /** Anyone who may work with leads needs the list for the lead form. */
  @Get()
  @RequirePermission(PERMISSIONS.LEADS_READ)
  list(@CurrentUser() actor: AuthUser, @Query('activeOnly') activeOnly?: string) {
    return this.sources.list(actor, activeOnly === 'true');
  }

  @Post()
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateLeadSourceRequestSchema))
    body: Infer<typeof CreateLeadSourceRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.sources.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateLeadSourceRequestSchema))
    body: Infer<typeof UpdateLeadSourceRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.sources.update(actor, id, body, req.ip);
  }
}

@ApiTags('campaigns')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CAMPAIGNS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(CampaignListQuerySchema)) q: Infer<typeof CampaignListQuerySchema>,
  ) {
    return this.campaigns.list(actor, q);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CAMPAIGNS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.campaigns.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateCampaignRequestSchema))
    body: Infer<typeof CreateCampaignRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.campaigns.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CAMPAIGNS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateCampaignRequestSchema))
    body: Infer<typeof UpdateCampaignRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.campaigns.update(actor, id, body, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.CAMPAIGNS_DELETE)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    await this.campaigns.remove(actor, id, req.ip);
  }
}
