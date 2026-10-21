import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VerifyEmailSchema } from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public } from '../../common/decorators';
import { RateLimiter } from '../../common/rate-limiter';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { EmailVerificationService } from './email-verification.service';

/** Public on purpose: the one-time token in the body is the credential (ADR 0014). */
@ApiTags('auth')
@Controller('auth')
export class EmailVerificationController {
  private readonly limiter = new RateLimiter(20, 60_000);

  constructor(private readonly verification: EmailVerificationService) {}

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  verify(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: z.infer<typeof VerifyEmailSchema>,
  ) {
    if (!this.limiter.allow(req.ip)) {
      throw new HttpException(
        { code: 'rate_limited', message: 'تلاش‌های بیش از حد. کمی بعد دوباره امتحان کنید.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.verification.verify(body.token, req.ip);
  }
}
