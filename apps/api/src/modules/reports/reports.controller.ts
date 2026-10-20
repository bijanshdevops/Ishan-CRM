import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DashboardQuerySchema, PERMISSIONS, ReportQuerySchema } from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  AuthenticatedOnly,
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ReportsService } from './reports.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;

@ApiTags('reports')
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Any signed-in user; each section appears only if they may read that data. */
  @Get('dashboard')
  @AuthenticatedOnly()
  dashboard(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(DashboardQuerySchema)) q: Infer<typeof DashboardQuerySchema>,
  ) {
    return this.reports.dashboard(actor, q);
  }

  @Get('reports/sales-performance')
  @RequirePermission(PERMISSIONS.REPORTS_READ)
  salesPerformance(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ReportQuerySchema)) q: Infer<typeof ReportQuerySchema>,
  ) {
    return this.reports.salesPerformance(actor, q);
  }

  /** Campaign return on investment (whole life of each campaign). */
  @Get('reports/campaigns')
  @RequirePermission(PERMISSIONS.REPORTS_READ, PERMISSIONS.CAMPAIGNS_READ)
  campaignRoi(@CurrentUser() actor: AuthUser) {
    return this.reports.campaignRoi(actor);
  }

  @Get('reports/lead-sources')
  @RequirePermission(PERMISSIONS.REPORTS_READ, PERMISSIONS.LEADS_READ)
  leadSources(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ReportQuerySchema)) q: Infer<typeof ReportQuerySchema>,
  ) {
    return this.reports.leadSources(actor, q);
  }

  @Get('reports/sales-performance.csv')
  @RequirePermission(PERMISSIONS.REPORTS_READ, PERMISSIONS.REPORTS_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="sales-performance.csv"')
  @Header('Cache-Control', 'no-store')
  salesPerformanceCsv(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ReportQuerySchema)) q: Infer<typeof ReportQuerySchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.reports.salesPerformanceCsv(actor, q, req.ip);
  }
}
