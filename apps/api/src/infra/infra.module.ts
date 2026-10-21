import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue/queue.service';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, PrismaService, QueueService],
  exports: [APP_CONFIG, PrismaService, QueueService],
})
export class InfraModule {}
