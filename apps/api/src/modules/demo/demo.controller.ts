import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionCookie } from '../../common/cookies';
import { Public } from '../../common/decorators';
import { APP_CONFIG, type AppConfig } from '../../config';
import { RateLimitService } from '../../infra/rate-limit.service';
import { SessionService } from '../auth/session.service';
import { DemoService } from './demo.service';

/** Only registered when DEMO_MODE=true (see AppModule); in every other deployment these routes do not exist. */
@ApiTags('demo')
@Controller('demo')
export class DemoController {
  private readonly secure: boolean;

  constructor(
    private readonly demo: DemoService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secure = config.COOKIE_SECURE ?? config.NODE_ENV === 'production';
  }

  /** Lets the web app know it is the demo (it hides nothing else: the data is fictional by construction). */
  @Get('info')
  @Public()
  info() {
    return { demo: true as const, resetEveryMinutes: 60 };
  }

  /** Signs the visitor in as the restricted demo user. Rate limited per IP. */
  @Post('session')
  @Public()
  @HttpCode(200)
  async start(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!(await this.limits.allow(`demo:session:${req.ip}`, 30, 60_000))) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کنید' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const userId = await this.demo.demoUserId();
    const { token } = await this.sessions.create(userId, req.ip, req.headers['user-agent']);
    void reply.header('Set-Cookie', sessionCookie(token, this.sessions.idleSeconds, this.secure));
    return { status: 'ok' as const };
  }
}
