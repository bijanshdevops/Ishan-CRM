import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activityScopeWhere,
  assertCanAssign,
  assertVisible,
  ownerInScope,
  ownerWhere,
  resolveOwner,
  seesAll,
} from '../src/common/access-scope';

const all = { id: 'u0', scopeUserIds: null };
const team = { id: 'u1', scopeUserIds: ['u1', 'u2'] };
const own = { id: 'u1', scopeUserIds: ['u1'] };

describe('access scope helpers', () => {
  it('ALL adds no restriction', () => {
    expect(seesAll(all)).toBe(true);
    expect(ownerWhere(all)).toEqual({});
    expect(activityScopeWhere(all)).toEqual({});
    expect(ownerInScope(all, null)).toBe(true);
  });

  it('restricted users filter on the owner column', () => {
    expect(ownerWhere(team)).toEqual({ ownerId: { in: ['u1', 'u2'] } });
    expect(ownerWhere(own, 'assigneeId')).toEqual({ assigneeId: { in: ['u1'] } });
    expect(ownerInScope(team, 'u2')).toBe(true);
    expect(ownerInScope(team, 'u9')).toBe(false);
    expect(ownerInScope(team, null)).toBe(false);
  });

  it('activities belong to the assignee, or to the creator while unassigned', () => {
    expect(activityScopeWhere(team)).toEqual({
      OR: [
        { assigneeId: { in: ['u1', 'u2'] } },
        { assigneeId: null, createdById: { in: ['u1', 'u2'] } },
      ],
    });
  });

  it('out of scope is reported as not found', () => {
    expect(() => assertVisible(team, 'u9', 'x')).toThrow(/x/);
    expect(() => assertVisible(team, 'u2', 'x')).not.toThrow();
  });

  it('a restricted user becomes the owner by default and cannot name outsiders', () => {
    expect(resolveOwner(team, undefined)).toBe('u1');
    expect(resolveOwner(team, 'u2')).toBe('u2');
    expect(() => resolveOwner(team, 'u9')).toThrow();
    expect(resolveOwner(all, undefined)).toBeUndefined();
    expect(resolveOwner(all, 'anyone')).toBe('anyone');
  });

  it('reassigning to nobody or outsiders is refused for restricted users', () => {
    expect(() => assertCanAssign(team, 'u9')).toThrow();
    expect(() => assertCanAssign(team, null)).toThrow();
    expect(() => assertCanAssign(team, 'u2')).not.toThrow();
    expect(() => assertCanAssign(all, null)).not.toThrow();
  });
});

/** Every service that reads business records must go through the shared scope helpers. */
describe('scope registry', () => {
  const services = [
    'customers/customers.service.ts',
    'customers/contacts.service.ts',
    'sales/leads.service.ts',
    'sales/deals.service.ts',
    'activities/activities.service.ts',
    'quotes/quotes.service.ts',
    'quotes/contracts.service.ts',
    'quotes/quote-delivery.service.ts',
    'marketing/campaigns.service.ts',
    'marketing/campaign-sending.service.ts',
    'reports/reports.service.ts',
  ];
  it.each(services)('%s uses the access-scope helpers', (file) => {
    const src = readFileSync(join(__dirname, '../src/modules', file), 'utf8');
    expect(src).toMatch(/common\/access-scope/);
  });

  it('no other module queries scoped records directly', () => {
    const scoped =
      /prisma\.(customer|contact|lead|deal|activity|quote|contract|campaign)\.(find|count|groupBy|aggregate)/;
    const allowed = new Set(services.map((s) => s.split('/')[1]));
    allowed.add('customers-io.service.ts'); // export uses buildWhere(actor); import dedupes org-wide on purpose
    allowed.add('pipeline.service.ts'); // stage configuration: org-wide count of deals in a stage
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && scoped.test(readFileSync(p, 'utf8')) && !allowed.has(name))
          offenders.push(p);
      }
    };
    walk(join(__dirname, '../src/modules'));
    expect(offenders).toEqual([]);
  });
});
