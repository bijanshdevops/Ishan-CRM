import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  MfaDisableRequestSchema,
  MfaEnableRequestSchema,
  type LoginRequest,
} from '@ishan/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clearSessionCookie, sessionCookie } from '../../common/cookies';
import {
  AllowPasswordChange,
  AuthenticatedOnly,
  CurrentUser,
  Public,
  type AuthUser,
} from '../../common/decorators';
import { RateLimiter } from '../../common/rate-limiter';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly loginLimiter: RateLimiter;
  private readonly secure: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.loginLimiter = new RateLimiter(config.LOGIN_RATE_LIMIT_PER_MINUTE, 60_000);
    this.secure = config.COOKIE_SECURE ?? config.NODE_ENV === 'production';
  }

  private client(req: FastifyRequest) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!this.loginLimiter.allow(req.ip)) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const result = await this.auth.login(body, this.client(req));
    if (result.status === 'mfa_required') return { status: 'mfa_required' as const };
    void reply.header(
      'Set-Cookie',
      sessionCookie(result.token, this.sessions.idleSeconds, this.secure),
    );
    return { status: 'ok' as const, user: result.user };
  }

  @Post('logout')
  @AuthenticatedOnly()
  @AllowPasswordChange()
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(user, this.client(req));
    void reply.header('Set-Cookie', clearSessionCookie(this.secure));
  }

  @Get('me')
  @AuthenticatedOnly()
  @AllowPasswordChange()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Post('change-password')
  @AuthenticatedOnly()
  @AllowPasswordChange()
  @HttpCode(204)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema))
    body: z.infer<typeof ChangePasswordRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.changePassword(user, body.currentPassword, body.newPassword, this.client(req));
  }

  @Post('mfa/setup')
  @AuthenticatedOnly()
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.mfaSetup(user);
  }

  @Post('mfa/enable')
  @AuthenticatedOnly()
  @HttpCode(204)
  mfaEnable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MfaEnableRequestSchema))
    body: z.infer<typeof MfaEnableRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.mfaEnable(user, body.code, this.client(req));
  }

  @Post('mfa/disable')
  @AuthenticatedOnly()
  @HttpCode(204)
  mfaDisable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MfaDisableRequestSchema))
    body: z.infer<typeof MfaDisableRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.mfaDisable(user, body.password, body.code, this.client(req));
  }

  @Get('sessions')
  @AuthenticatedOnly()
  async listSessions(@CurrentUser() user: AuthUser) {
    const rows = await this.sessions.listActive(user.id);
    return rows.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === user.sessionId,
    }));
  }

  @Delete('sessions/:id')
  @AuthenticatedOnly()
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    if (!(await this.sessions.revoke(id, user.id))) throw new NotFoundException('نشست یافت نشد');
  }
}
