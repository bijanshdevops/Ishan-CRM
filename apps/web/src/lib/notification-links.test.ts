import { PERMISSIONS, type Permission } from '@ishan/contracts';
import { describe, expect, it } from 'vitest';
import { notificationHref } from './notification-links';

const all = () => true;
const none = () => false;
const only =
  (...ps: Permission[]) =>
  (p: Permission) =>
    ps.includes(p);
const ID = '0197c0de-0000-7000-8000-000000000001';

describe('notificationHref', () => {
  it('maps each entity to its page', () => {
    expect(notificationHref({ entityType: 'customer', entityId: ID }, all)).toBe(
      `/customers/${ID}`,
    );
    expect(notificationHref({ entityType: 'quote', entityId: ID }, all)).toBe(`/quotes/${ID}`);
    expect(notificationHref({ entityType: 'contract', entityId: ID }, all)).toBe(
      `/contracts/${ID}`,
    );
    expect(notificationHref({ entityType: 'deal', entityId: ID }, all)).toBe('/deals');
    expect(notificationHref({ entityType: 'lead', entityId: ID }, all)).toBe('/leads');
    expect(notificationHref({ entityType: 'activity', entityId: ID }, all)).toBe('/activities');
  });

  it('offers no link without the read permission or without an entity', () => {
    expect(notificationHref({ entityType: 'deal', entityId: ID }, none)).toBeNull();
    expect(
      notificationHref({ entityType: 'deal', entityId: ID }, only(PERMISSIONS.CUSTOMERS_READ)),
    ).toBeNull();
    expect(notificationHref({ entityType: null, entityId: null }, all)).toBeNull();
  });
});
