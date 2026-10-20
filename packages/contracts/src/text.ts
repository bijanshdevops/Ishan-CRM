const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Converts Persian/Arabic-Indic digits to ASCII. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const a = AR_DIGITS.indexOf(ch);
    return String(a >= 0 ? a : FA_DIGITS.indexOf(ch));
  });
}

/**
 * Canonical form for storing/searching Persian text: unifies Arabic/Persian
 * letter variants (ي/ى→ی, ك→ک), digits, removes diacritics/tatweel, maps ZWNJ
 * to a space, collapses whitespace and lowercases.
 */
export function normalizeText(input: string): string {
  return toAsciiDigits(input)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ۀ/g, 'ه')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Keeps digits and a leading '+', for phone matching. */
export function normalizePhone(input: string): string {
  const s = toAsciiDigits(input).replace(/[\s\-()]/g, '');
  return s.startsWith('+') ? `+${s.slice(1).replace(/\D/g, '')}` : s.replace(/\D/g, '');
}
