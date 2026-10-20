import { describe, expect, it } from 'vitest';
import { formatCompactToman, formatJalaliDate, formatMoney, formatNumber } from './format';

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

  it('formats compact toman amounts from rials', () => {
    expect(formatCompactToman(25_000_000_000n)).toBe('۲٫۵ میلیارد');
    expect(formatCompactToman(10_000_000n)).toBe('۱ میلیون');
    expect(formatCompactToman(15_000n)).toBe('۱٫۵ هزار');
    expect(formatCompactToman(5_000n)).toBe('۵۰۰');
    expect(formatCompactToman(0n)).toBe('۰');
  });
});
