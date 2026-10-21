import { Module } from '@nestjs/common';
import { CampaignSendingController, UnsubscribeController } from './campaign-sending.controller';
import { CampaignSendingService } from './campaign-sending.service';
import { CampaignsService } from './campaigns.service';
import { LeadSourcesService } from './lead-sources.service';
import { CampaignsController, LeadSourcesController } from './marketing.controller';

@Module({
  controllers: [
    LeadSourcesController,
    CampaignsController,
    CampaignSendingController,
    UnsubscribeController,
  ],
  providers: [LeadSourcesService, CampaignsService, CampaignSendingService],
})
export class MarketingModule {}
