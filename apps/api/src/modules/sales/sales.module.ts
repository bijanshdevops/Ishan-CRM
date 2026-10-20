import { Module } from '@nestjs/common';
import { DealsService } from './deals.service';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';
import { DealsController, LeadsController, PipelineController } from './sales.controller';

@Module({
  controllers: [LeadsController, DealsController, PipelineController],
  providers: [LeadsService, DealsService, PipelineService],
})
export class SalesModule {}
