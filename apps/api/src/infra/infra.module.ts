import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config';
import { PrismaService } from './prisma.service';
import { RateLimitService } from './rate-limit.service';
import { QueueService } from './queue/queue.service';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    QueueService,
    RateLimitService,
  ],
  exports: [APP_CONFIG, PrismaService, QueueService, RateLimitService],
})
export class InfraModule {}
