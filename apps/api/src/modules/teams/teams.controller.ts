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
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AddTeamMemberRequestSchema,
  CreateTeamRequestSchema,
  PERMISSIONS,
  UpdateTeamRequestSchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.TEAMS_READ)
  list(@CurrentUser() actor: AuthUser) {
    return this.teams.list(actor);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.TEAMS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.teams.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.TEAMS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateTeamRequestSchema))
    body: z.infer<typeof CreateTeamRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.teams.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TEAMS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateTeamRequestSchema))
    body: z.infer<typeof UpdateTeamRequestSchema>,
    @Req() req: FastifyRequest,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.teams.update(actor, id, body, req.ip, ifMatch);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TEAMS_WRITE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.teams.remove(actor, id, req.ip);
  }

  @Put(':id/members')
  @RequirePermission(PERMISSIONS.TEAMS_WRITE)
  @HttpCode(204)
  addMember(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AddTeamMemberRequestSchema))
    body: z.infer<typeof AddTeamMemberRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.teams.addMember(actor, id, body, req.ip);
  }

  @Delete(':id/members/:userId')
  @RequirePermission(PERMISSIONS.TEAMS_WRITE)
  @HttpCode(204)
  removeMember(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.teams.removeMember(actor, id, userId, req.ip);
  }
}
