/**
 * All monetary amounts are stored as integer Rials (BigInt in the database,
 * decimal string on the wire to avoid JSON precision loss).
 */
const RIAL_PATTERN = /^-?\d{1,18}$/;

export function parseRial(value: string): bigint {
  if (!RIAL_PATTERN.test(value)) {
    throw new RangeError(`Invalid rial amount: ${value}`);
  }
  return BigInt(value);
}

export function serializeRial(value: bigint): string {
  return value.toString();
}

export const RIAL_PER_TOMAN = 10n;

export function rialToToman(value: bigint): bigint {
  return value / RIAL_PER_TOMAN;
}
