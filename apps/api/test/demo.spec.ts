import { ALL_PERMISSIONS, PERMISSIONS } from '@ishan/contracts';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  DEMO_PERMISSIONS,
  DEMO_RESET_TABLES,
  DEMO_ROLE_KEY,
} from '../src/modules/demo/demo.constants';
import { DemoRestrictionsGuard } from '../src/modules/demo/demo.guard';

const ctx = (url: string, roleKey: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ url, user: { roleKey } }) }),
  }) as unknown as ExecutionContext;

describe('demo role', () => {
  it('only grants known permissions', () => {
    for (const p of DEMO_PERMISSIONS) expect(ALL_PERMISSIONS).toContain(p);
  });
  it('cannot administer the system, send mail, call out or move bulk data', () => {
    const forbidden = [
      PERMISSIONS.USERS_WRITE,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.ROLES_WRITE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.WEBHOOKS_READ,
      PERMISSIONS.WEBHOOKS_WRITE,
      PERMISSIONS.WEBHOOKS_DELETE,
      PERMISSIONS.CAMPAIGNS_SEND,
      PERMISSIONS.CAMPAIGNS_DELETE,
      PERMISSIONS.CUSTOMERS_IMPORT,
      PERMISSIONS.CUSTOMERS_EXPORT,
      PERMISSIONS.REPORTS_EXPORT,
      PERMISSIONS.PIPELINE_MANAGE,
      PERMISSIONS.WORKFLOWS_WRITE,
      PERMISSIONS.WORKFLOWS_DELETE,
    ];
    for (const p of forbidden) expect(DEMO_PERMISSIONS).not.toContain(p);
  });
  it('the reset never touches accounts, roles, sessions or configuration', () => {
    for (const t of [
      'users',
      'roles',
      'sessions',
      'organizations',
      'pipeline_stages',
      'lead_sources',
    ]) {
      expect(DEMO_RESET_TABLES as readonly string[]).not.toContain(t);
    }
  });
});

describe('DemoRestrictionsGuard', () => {
  const guard = new DemoRestrictionsGuard();
  it('blocks credential changes for the demo user', () => {
    for (const url of [
      '/api/v1/auth/change-password',
      '/api/v1/auth/mfa/setup',
      '/api/v1/auth/mfa/enable?x=1',
    ]) {
      expect(() => guard.canActivate(ctx(url, DEMO_ROLE_KEY))).toThrow(ForbiddenException);
    }
  });
  it('lets the demo user use everything else', () => {
    expect(guard.canActivate(ctx('/api/v1/customers', DEMO_ROLE_KEY))).toBe(true);
    expect(guard.canActivate(ctx('/api/v1/auth/logout', DEMO_ROLE_KEY))).toBe(true);
  });
  it('does not affect other roles', () => {
    expect(guard.canActivate(ctx('/api/v1/auth/change-password', 'admin'))).toBe(true);
  });
});
