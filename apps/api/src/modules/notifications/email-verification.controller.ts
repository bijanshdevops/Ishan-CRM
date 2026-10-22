import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VerifyEmailSchema } from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { RateLimitService } from '../../infra/rate-limit.service';
import { EmailVerificationService } from './email-verification.service';

/** Public on purpose: the one-time token in the body is the credential (ADR 0014). */
@ApiTags('auth')
@Controller('auth')
export class EmailVerificationController {
  constructor(
    private readonly verification: EmailVerificationService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  async verify(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: z.infer<typeof VerifyEmailSchema>,
  ) {
    if (!(await this.rateLimit.allow(`verify-email:ip:${req.ip}`, 20, 60_000))) {
      throw new HttpException(
        { code: 'rate_limited', message: 'تلاش‌های بیش از حد. کمی بعد دوباره امتحان کنید.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.verification.verify(body.token, req.ip);
  }
}
