import { describe, expect, it } from 'vitest';
import {
  CreateCampaignRequestSchema,
  UpdateCampaignRequestSchema,
  roiBasisPoints,
} from './marketing';

describe('roiBasisPoints', () => {
  it('is (won - budget) / budget in basis points', () => {
    expect(roiBasisPoints(5_000_000n, 1_000_000n)).toBe(40_000);
    expect(roiBasisPoints(1_000_000n, 1_000_000n)).toBe(0);
    expect(roiBasisPoints(0n, 1_000_000n)).toBe(-10_000);
  });
  it('is null without a budget', () => {
    expect(roiBasisPoints(5n, 0n)).toBeNull();
  });
});

describe('campaign requests', () => {
  it('rejects an end before the start and unknown fields', () => {
    expect(
      CreateCampaignRequestSchema.safeParse({
        name: 'کمپین',
        startDate: '2026-10-10',
        endDate: '2026-10-01',
      }).success,
    ).toBe(false);
    expect(CreateCampaignRequestSchema.safeParse({ name: 'کمپین', x: 1 }).success).toBe(false);
  });
  it('applies defaults on create but not on update', () => {
    const c = CreateCampaignRequestSchema.parse({ name: 'کمپین' });
    expect(c).toMatchObject({ status: 'PLANNED', budget: '0' });
    expect(UpdateCampaignRequestSchema.parse({ name: 'کمپین' })).toEqual({ name: 'کمپین' });
  });
});
