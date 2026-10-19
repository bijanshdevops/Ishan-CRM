import { describe, expect, it } from 'vitest';
import { formatJalaliDate, formatMoney, formatNumber } from './format';

describe('format', () => {
  it('converts Gregorian instant to Jalali date', () => {
    // 2026-03-21 is 1 Farvardin 1405
    expect(formatJalaliDate('2026-03-21T12:00:00Z')).toMatch(/۱۴۰۵\/۰۱\/۰۱/);
  });
  it('formats numbers with Persian digits', () => {
    expect(formatNumber(1234)).toContain('۱');
  });
  it('formats money in rial and toman', () => {
    expect(formatMoney(1000n)).toContain('ریال');
    expect(formatMoney(1000n, 'toman')).toContain('تومان');
  });
});
