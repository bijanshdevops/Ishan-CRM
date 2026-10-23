import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DEMO_BLOCKED_ROUTES, DEMO_ROLE_KEY } from './demo.constants';

/** Runs after the permission guard: the demo visitor cannot change the shared account's credentials. */
@Injectable()
export class DemoRestrictionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (req.user?.roleKey !== DEMO_ROLE_KEY) return true;
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (DEMO_BLOCKED_ROUTES.some((r) => r.test(path))) {
      throw new ForbiddenException({
        code: 'DEMO_RESTRICTED',
        message: 'این عملیات در نسخه نمایشی غیرفعال است',
      });
    }
    return true;
  }
}
