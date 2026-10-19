import { Module } from '@nestjs/common';
import { ActivitiesController, CustomerTimelineController } from './activities.controller';
import { ActivitiesService } from './activities.service';

@Module({
  controllers: [ActivitiesController, CustomerTimelineController],
  providers: [ActivitiesService],
})
export class ActivitiesModule {}
