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
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateRoleRequestSchema, PERMISSIONS, UpdateRoleRequestSchema } from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ROLES_READ)
  list(@CurrentUser() actor: AuthUser) {
    return this.roles.list(actor);
  }

  @Get('permissions')
  @RequirePermission(PERMISSIONS.ROLES_READ)
  catalog() {
    return this.roles.catalog();
  }

  @Post()
  @RequirePermission(PERMISSIONS.ROLES_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateRoleRequestSchema))
    body: z.infer<typeof CreateRoleRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.roles.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ROLES_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateRoleRequestSchema))
    body: z.infer<typeof UpdateRoleRequestSchema>,
    @Req() req: FastifyRequest,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.roles.update(actor, id, body, req.ip, ifMatch);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.ROLES_WRITE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.roles.remove(actor, id, req.ip);
  }
}
