import { normalizeText } from '@ishan/contracts';

/** Parses a user-typed toman amount (Persian/Latin digits, separators allowed) to integer rials. */
export function tomanInputToRial(input: string): bigint | null {
  const s = normalizeText(input).replace(/[,٬،\s]/g, '');
  if (!/^\d{1,14}$/.test(s)) return null;
  return BigInt(s) * 10n;
}

/** Integer rials → plain toman digits for an input's initial value. */
export function rialToTomanInput(rial: string | bigint): string {
  return (BigInt(rial) / 10n).toString();
}
