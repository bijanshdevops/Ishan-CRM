import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';

export const IS_PUBLIC = 'ishan:public';
export const AUTHENTICATED_ONLY = 'ishan:authenticated-only';
export const PERMISSIONS_KEY = 'ishan:permissions';
export const ALLOW_PASSWORD_CHANGE = 'ishan:allow-password-change';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Any authenticated user (no specific permission). Must be explicit: routes are deny-by-default. */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY, true);
/** All listed permissions are required. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
/** Reachable while the user still has to change a temporary password. */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);

export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  sessionId: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<FastifyRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
