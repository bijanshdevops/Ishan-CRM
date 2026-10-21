import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import type { HealthStatus } from '@ishan/contracts';
import type { FastifyReply } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness: the process is up. No dependencies are checked. */
  @Get('live')
  live(): HealthStatus {
    return this.snapshot({});
  }

  /** Readiness: dependencies required to serve traffic are reachable. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthStatus> {
    const database = (await this.prisma.ping()) ? 'up' : 'down';
    const checks: Record<string, 'up' | 'down'> = { database };
    // Redis is only a readiness dependency when it is configured (queues are optional for the API).
    if (this.queues.enabled) checks.redis = (await this.queues.ping()) ? 'up' : 'down';
    const body = this.snapshot(checks);
    if (body.status === 'error') void reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }

  private snapshot(checks: Record<string, 'up' | 'down'>): HealthStatus {
    const down = Object.values(checks).includes('down');
    return {
      status: down ? 'error' : 'ok',
      checks,
      version: this.config.APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
