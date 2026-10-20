import 'reflect-metadata';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, SYSTEM_ROLES, isPermission } from '@ishan/contracts';
import { applyTestEnv } from './helpers';

/** Every route must declare an access policy; the global guard denies anything that does not. */
describe('access policy coverage', () => {
  const routes: Array<{ route: string; policy: unknown }> = [];

  beforeAll(async () => {
    applyTestEnv();
    const { AppModule } = await import('../src/app.module');
    const { PrismaService } = await import('../src/infra/prisma.service');
    const { IS_PUBLIC, AUTHENTICATED_ONLY, PERMISSIONS_KEY } = await import(
      '../src/common/decorators'
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    const reflector = moduleRef.get(Reflector);
    for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (
          name === 'constructor' ||
          typeof handler !== 'function' ||
          Reflect.getMetadata('path', handler) === undefined
        )
          continue;
        const targets = [handler, instance.constructor];
        const policy =
          reflector.getAllAndOverride(IS_PUBLIC, targets) ||
          reflector.getAllAndOverride(AUTHENTICATED_ONLY, targets) ||
          reflector.getAllAndOverride(PERMISSIONS_KEY, targets);
        routes.push({ route: `${instance.constructor.name}.${name}`, policy });
      }
    }
  });

  it('finds the application routes', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('every route declares @Public, @AuthenticatedOnly or @RequirePermission', () => {
    const missing = routes.filter((r) => !r.policy).map((r) => r.route);
    expect(missing).toEqual([]);
  });
});

describe('permission catalog', () => {
  it('system roles only grant known permissions and admin has all', () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
    expect(SYSTEM_ROLES.find((r) => r.key === 'admin')?.permissions).toEqual(ALL_PERMISSIONS);
  });
});
