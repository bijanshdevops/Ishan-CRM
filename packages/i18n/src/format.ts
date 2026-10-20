const JALALI_DATE = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tehran',
});

const JALALI_DATE_LONG = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
  timeZone: 'Asia/Tehran',
});

const NUMBER = new Intl.NumberFormat('fa-IR');

/** Jalali (Persian calendar) short date, e.g. ۱۴۰۵/۰۷/۲۷. Input is an instant (UTC in storage). */
export function formatJalaliDate(date: Date | string | number): string {
  return JALALI_DATE.format(new Date(date)).replace(/‏/g, '');
}

export function formatJalaliDateLong(date: Date | string | number): string {
  return JALALI_DATE_LONG.format(new Date(date));
}

export function formatNumber(value: number | bigint): string {
  return NUMBER.format(value);
}

export type CurrencyUnit = 'rial' | 'toman';

/** Amounts are stored in integer rials; display unit is a UI preference. */
export function formatMoney(rials: bigint, unit: CurrencyUnit = 'rial'): string {
  const amount = unit === 'toman' ? rials / 10n : rials;
  return `${NUMBER.format(amount)} ${unit === 'toman' ? 'تومان' : 'ریال'}`;
}

const JALALI_DATETIME = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tehran',
});

/** Jalali date and local (Tehran) time, e.g. ۱۴۰۵/۰۷/۲۷، ۲۱:۳۰. */
export function formatJalaliDateTime(date: Date | string | number): string {
  return JALALI_DATETIME.format(new Date(date));
}

const COMPACT_STEPS: Array<[bigint, string]> = [
  [1_000_000_000_000n, 'همت'],
  [1_000_000_000n, 'میلیارد'],
  [1_000_000n, 'میلیون'],
  [1_000n, 'هزار'],
];
const ONE_DECIMAL = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });

/**
 * Compact amount for charts and tiles: integer rials in, toman out ("۲٫۵ میلیارد").
 * Values below one thousand toman are shown in full.
 */
export function formatCompactToman(rials: bigint): string {
  const toman = rials / 10n;
  const abs = toman < 0n ? -toman : toman;
  for (const [step, unit] of COMPACT_STEPS) {
    if (abs >= step) {
      // keep one decimal of precision without floating point on huge values
      const tenths = (toman * 10n) / step;
      return `${ONE_DECIMAL.format(Number(tenths) / 10)} ${unit}`;
    }
  }
  return NUMBER.format(toman);
}
