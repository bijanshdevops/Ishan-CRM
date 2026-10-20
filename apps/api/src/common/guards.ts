import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../config';
import { SessionService } from '../modules/auth/session.service';
import { SESSION_COOKIE, parseCookies } from './cookies';
import {
  ALLOW_PASSWORD_CHANGE,
  AUTHENTICATED_ONLY,
  IS_PUBLIC,
  PERMISSIONS_KEY,
} from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defence for cookie auth: state-changing requests must come from an allowed Origin. */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const origin = req.headers.origin;
    const hasSession = SESSION_COOKIE in parseCookies(req.headers.cookie);
    if (!origin) {
      if (hasSession) throw new ForbiddenException('Origin required');
      return true;
    }
    if (this.config.CORS_ORIGINS.includes(origin)) return true;
    const selfOrigin = `${req.protocol}://${req.headers.host}`;
    if (origin === selfOrigin) return true;
    throw new ForbiddenException('Origin not allowed');
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = token ? await this.sessions.authenticate(token) : null;
    if (!user) throw new UnauthorizedException('نیاز به ورود به سیستم');
    req.user = user;
    return true;
  }
}

/** Deny-by-default: a route must declare @Public, @AuthenticatedOnly or @RequirePermission. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const user = context.switchToHttp().getRequest<FastifyRequest>().user;
    if (!user) throw new UnauthorizedException('نیاز به ورود به سیستم');

    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, targets)
    ) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'ابتدا باید گذرواژه را تغییر دهید',
      });
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const authOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY, targets);
    if (!required && !authOnly) throw new ForbiddenException('Route has no access policy');
    if (required && !required.every((p) => user.permissions.includes(p))) {
      throw new ForbiddenException('دسترسی کافی ندارید');
    }
    return true;
  }
}
