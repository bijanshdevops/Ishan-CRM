import { describe, expect, it } from 'vitest';
import { normalizePhone, normalizeText, toAsciiDigits } from './text';

describe('text normalization', () => {
  it('unifies Arabic and Persian letter variants', () => {
    expect(normalizeText('علي كريمي')).toBe(normalizeText('علی کریمی'));
  });
  it('converts digits and ZWNJ', () => {
    expect(toAsciiDigits('۰۹۱۲٣')).toBe('09123');
    expect(normalizeText('می‌خواهم  ABC')).toBe('می خواهم abc');
  });
  it('normalizes phones', () => {
    expect(normalizePhone('۰۹۱۲ ۳۴۵-۶۷۸۹')).toBe('09123456789');
    expect(normalizePhone('+98 (912) 345 6789')).toBe('+989123456789');
  });
});
