import {
  Body,
  Controller,
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
  CreateUserRequestSchema,
  ListQuerySchema,
  PERMISSIONS,
  ResetPasswordRequestSchema,
  UpdateUserRequestSchema,
  type CreateUserRequest,
  type ListQuery,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.USERS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery,
  ) {
    return this.users.list(actor, q);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.USERS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.USERS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateUserRequestSchema)) body: CreateUserRequest,
    @Req() req: FastifyRequest,
  ) {
    return this.users.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.USERS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateUserRequestSchema))
    body: z.infer<typeof UpdateUserRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.users.update(actor, id, body, req.ip);
  }

  @Post(':id/reset-password')
  @RequirePermission(PERMISSIONS.USERS_WRITE)
  @HttpCode(204)
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ResetPasswordRequestSchema))
    body: z.infer<typeof ResetPasswordRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.users.resetPassword(actor, id, body.newPassword, req.ip);
  }
}
