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
  ActivityListQuerySchema,
  CalendarQuerySchema,
  CompleteActivityRequestSchema,
  CreateActivityRequestSchema,
  PERMISSIONS,
  TimelineQuerySchema,
  UpdateActivityRequestSchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ActivitiesService } from './activities.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();

@ApiTags('activities')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ACTIVITIES_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ActivityListQuerySchema))
    q: Infer<typeof ActivityListQuerySchema>,
  ) {
    return this.activities.list(actor, q);
  }

  // Static segments must be declared before ':id'.
  @Get('calendar')
  @RequirePermission(PERMISSIONS.ACTIVITIES_READ)
  calendar(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(CalendarQuerySchema)) q: Infer<typeof CalendarQuerySchema>,
  ) {
    return this.activities.calendar(actor, q);
  }

  @Get('reminders/due')
  @RequirePermission(PERMISSIONS.ACTIVITIES_READ)
  dueReminders(@CurrentUser() actor: AuthUser) {
    return this.activities.dueReminders(actor);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.ACTIVITIES_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.activities.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ACTIVITIES_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateActivityRequestSchema))
    body: Infer<typeof CreateActivityRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.activities.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ACTIVITIES_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateActivityRequestSchema))
    body: Infer<typeof UpdateActivityRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.activities.update(actor, id, body, req.ip);
  }

  @Post(':id/complete')
  @RequirePermission(PERMISSIONS.ACTIVITIES_WRITE)
  @HttpCode(200)
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(CompleteActivityRequestSchema))
    body: Infer<typeof CompleteActivityRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.activities.complete(actor, id, body, req.ip);
  }

  @Post(':id/reopen')
  @RequirePermission(PERMISSIONS.ACTIVITIES_WRITE)
  @HttpCode(200)
  reopen(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.activities.reopen(actor, id, req.ip);
  }

  @Post(':id/cancel')
  @RequirePermission(PERMISSIONS.ACTIVITIES_WRITE)
  @HttpCode(200)
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.activities.cancel(actor, id, req.ip);
  }

  @Post(':id/reminder/dismiss')
  @RequirePermission(PERMISSIONS.ACTIVITIES_WRITE)
  @HttpCode(204)
  dismissReminder(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.activities.dismissReminder(actor, id, req.ip);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.ACTIVITIES_DELETE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.activities.remove(actor, id, req.ip);
  }
}

@ApiTags('activities')
@Controller('customers')
export class CustomerTimelineController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get(':id/timeline')
  @RequirePermission(PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.ACTIVITIES_READ)
  timeline(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(TimelineQuerySchema)) q: Infer<typeof TimelineQuerySchema>,
  ) {
    return this.activities.timeline(actor, id, q);
  }
}
