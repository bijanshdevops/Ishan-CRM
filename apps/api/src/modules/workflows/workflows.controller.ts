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
  CreateWorkflowRequestSchema,
  PERMISSIONS,
  UpdateWorkflowRequestSchema,
  WorkflowRunListQuerySchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { WorkflowsService } from './workflows.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();
const ListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  // Static segments must be declared before ':id'.
  @Get('catalog')
  @RequirePermission(PERMISSIONS.WORKFLOWS_READ)
  catalog() {
    return this.workflows.catalog();
  }

  @Get()
  @RequirePermission(PERMISSIONS.WORKFLOWS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: Infer<typeof ListQuerySchema>,
  ) {
    return this.workflows.list(actor, q);
  }

  @Post()
  @RequirePermission(PERMISSIONS.WORKFLOWS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateWorkflowRequestSchema))
    body: Infer<typeof CreateWorkflowRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.workflows.create(actor, body, req.ip);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.WORKFLOWS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.workflows.get(actor, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.WORKFLOWS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateWorkflowRequestSchema))
    body: Infer<typeof UpdateWorkflowRequestSchema>,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.workflows.update(actor, id, body, ifMatch, req.ip);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.WORKFLOWS_WRITE)
  enable(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.workflows.setEnabled(actor, id, true, req.ip);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.WORKFLOWS_WRITE)
  disable(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.workflows.setEnabled(actor, id, false, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.WORKFLOWS_DELETE)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    await this.workflows.remove(actor, id, req.ip);
  }

  @Get(':id/runs')
  @RequirePermission(PERMISSIONS.WORKFLOWS_READ)
  runs(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(WorkflowRunListQuerySchema))
    q: Infer<typeof WorkflowRunListQuerySchema>,
  ) {
    return this.workflows.runs(actor, id, q);
  }
}
