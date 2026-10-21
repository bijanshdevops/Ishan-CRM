import { describe, expect, it } from 'vitest';
import {
  DOMAIN_EVENT_PAYLOADS,
  DOMAIN_EVENT_TYPES,
  TIME_BASED_EVENT_TYPES,
  type DomainEventType,
} from './events';

const ID = '0197c0de-0000-7000-8000-000000000001';

describe('domain event catalog', () => {
  it('has a strict payload schema for every type and the time-based ones are in the catalog', () => {
    expect(DOMAIN_EVENT_TYPES.length).toBe(8);
    for (const t of TIME_BASED_EVENT_TYPES) expect(DOMAIN_EVENT_TYPES).toContain(t);
  });

  it('accepts a valid payload and rejects unknown, missing and mistyped fields', () => {
    const schema = DOMAIN_EVENT_PAYLOADS['deal.stage_changed'];
    const ok = {
      title: 'فروش',
      customerId: ID,
      fromStageId: ID,
      stageId: ID,
      stageKind: 'WON',
      amount: '1000000',
      ownerId: null,
    };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...ok, stageKind: 'MAYBE' }).success).toBe(false);
    expect(schema.safeParse({ ...ok, amount: '-5' }).success).toBe(false);
    const { title: _t, ...missing } = ok;
    expect(schema.safeParse(missing).success).toBe(false);
  });

  it('money is an integer-rial string, never a number', () => {
    const t: DomainEventType = 'quote.accepted';
    const base = { number: 'QT-000001', title: 'x', customerId: ID, ownerId: null };
    expect(DOMAIN_EVENT_PAYLOADS[t].safeParse({ ...base, total: '250000' }).success).toBe(true);
    expect(DOMAIN_EVENT_PAYLOADS[t].safeParse({ ...base, total: 250000 }).success).toBe(false);
  });
});
