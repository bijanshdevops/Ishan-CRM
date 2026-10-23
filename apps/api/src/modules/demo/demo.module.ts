import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { DemoRestrictionsGuard } from './demo.guard';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [AuthModule],
  controllers: [DemoController],
  providers: [DemoService, { provide: APP_GUARD, useClass: DemoRestrictionsGuard }],
  exports: [DemoService],
})
export class DemoModule {}
