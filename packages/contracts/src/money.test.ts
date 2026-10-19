import { describe, expect, it } from 'vitest';
import { parseRial, rialToToman, serializeRial } from './money';

describe('money', () => {
  it('round-trips integer rial amounts', () => {
    expect(serializeRial(parseRial('1250000'))).toBe('1250000');
  });
  it('rejects decimals and garbage', () => {
    expect(() => parseRial('12.5')).toThrow(RangeError);
    expect(() => parseRial('abc')).toThrow(RangeError);
  });
  it('converts rial to toman', () => {
    expect(rialToToman(1000n)).toBe(100n);
  });
});
