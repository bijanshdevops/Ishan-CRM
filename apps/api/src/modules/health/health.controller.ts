import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { HealthStatus } from '@ishan/contracts';
import type { FastifyReply } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
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
    const body = this.snapshot({ database });
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
