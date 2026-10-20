import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { LeadSourcesService } from './lead-sources.service';
import { CampaignsController, LeadSourcesController } from './marketing.controller';

@Module({
  controllers: [LeadSourcesController, CampaignsController],
  providers: [LeadSourcesService, CampaignsService],
})
export class MarketingModule {}
