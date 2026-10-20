import { describe, expect, it } from 'vitest';
import { CreateQuoteRequestSchema, calculateQuoteTotals, QUOTE_TRANSITIONS } from './quotes';

describe('calculateQuoteTotals', () => {
  it('sums lines, applies discount then tax', () => {
    const t = calculateQuoteTotals(
      [
        { quantity: 2, unitPrice: 1_000_000n },
        { quantity: 1, unitPrice: 500_000n },
      ],
      500_000n,
      1000,
    );
    expect(t.subtotal).toBe(2_500_000n);
    expect(t.taxableAmount).toBe(2_000_000n);
    expect(t.taxAmount).toBe(200_000n);
    expect(t.total).toBe(2_200_000n);
  });

  it('rounds tax half up to the rial and handles values beyond 2^53', () => {
    expect(calculateQuoteTotals([{ quantity: 1, unitPrice: 15n }], 0n, 1000).taxAmount).toBe(2n);
    expect(calculateQuoteTotals([{ quantity: 1, unitPrice: 14n }], 0n, 1000).taxAmount).toBe(1n);
    const big = 9_007_199_254_740_993n;
    expect(calculateQuoteTotals([{ quantity: 1, unitPrice: big }], 0n, 0).total).toBe(big);
  });

  it('rejects invalid inputs', () => {
    expect(() => calculateQuoteTotals([{ quantity: 1, unitPrice: 10n }], 11n, 0)).toThrow();
    expect(() => calculateQuoteTotals([{ quantity: 0, unitPrice: 10n }], 0n, 0)).toThrow();
    expect(() => calculateQuoteTotals([{ quantity: 1, unitPrice: 10n }], 0n, 10_001)).toThrow();
    expect(() => calculateQuoteTotals([{ quantity: 1, unitPrice: -1n }], 0n, 0)).toThrow();
  });
});

describe('CreateQuoteRequestSchema', () => {
  const base = {
    title: 'پیشنهاد آزمون',
    customerId: '0192f2a0-0000-7000-8000-000000000001',
    items: [{ description: 'خدمت', quantity: 1, unitPrice: '1000' }],
  };
  it('applies defaults', () => {
    const r = CreateQuoteRequestSchema.parse(base);
    expect(r.discount).toBe('0');
    expect(r.taxRateBp).toBe(1000);
  });
  it('rejects discount above subtotal, empty items and reversed dates', () => {
    expect(CreateQuoteRequestSchema.safeParse({ ...base, discount: '2000' }).success).toBe(false);
    expect(CreateQuoteRequestSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(
      CreateQuoteRequestSchema.safeParse({
        ...base,
        issueDate: '2026-05-02',
        validUntil: '2026-05-01',
      }).success,
    ).toBe(false);
  });
});

describe('QUOTE_TRANSITIONS', () => {
  it('only moves forward', () => {
    expect(QUOTE_TRANSITIONS.DRAFT).toEqual(['SENT']);
    expect(QUOTE_TRANSITIONS.ACCEPTED).toEqual([]);
  });
});
