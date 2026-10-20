import { describe, expect, it } from 'vitest';
import { DashboardQuerySchema, ReportQuerySchema } from './reports';

describe('report query contracts', () => {
  it('defaults to the personal scope and an open range', () => {
    const r = DashboardQuerySchema.parse({});
    expect(r.scope).toBe('me');
    expect(r.from).toBeUndefined();
  });
  it('rejects inverted and oversized ranges', () => {
    expect(
      DashboardQuerySchema.safeParse({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' })
        .success,
    ).toBe(false);
    expect(
      ReportQuerySchema.safeParse({ from: '2025-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })
        .success,
    ).toBe(false);
    expect(
      ReportQuerySchema.safeParse({ from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })
        .success,
    ).toBe(true);
  });
  it('rejects unknown scopes', () => {
    expect(DashboardQuerySchema.safeParse({ scope: 'everyone' }).success).toBe(false);
  });
});
