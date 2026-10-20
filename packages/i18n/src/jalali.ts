/**
 * Jalali (Persian) calendar arithmetic and Tehran wall-clock conversion.
 * Storage and the API stay in UTC instants; this is used by the UI only.
 * Iran has had a fixed UTC+03:30 offset since 2022 (no DST), so conversion is arithmetic.
 */

export type JalaliDate = readonly [year: number, month: number, day: number];

const G_DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    G_DAYS_BEFORE_MONTH[gm - 1]!;
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy0: number, jm: number, jd: number): JalaliDate {
  const jy = jy0 + 1595;
  let days =
    -355668 +
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 12 && gd > lengths[gm]!) {
    gd -= lengths[gm]!;
    gm += 1;
  }
  return [gy, gm + 1, gd];
}

export function isJalaliLeapYear(jy: number): boolean {
  const [gy, gm, gd] = jalaliToGregorian(jy, 12, 30);
  const [ry, rm, rd] = gregorianToJalali(gy, gm, gd);
  return ry === jy && rm === 12 && rd === 30;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

/** Saturday-first week, as used in Iran. Index 0 = شنبه. */
export const JALALI_WEEKDAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
] as const;

export const TEHRAN_OFFSET_MINUTES = 210;
const MS_PER_MIN = 60_000;

export interface JalaliDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** UTC instant → Tehran wall-clock expressed in the Jalali calendar. */
export function instantToJalali(instant: Date | string | number): JalaliDateTime {
  const shifted = new Date(new Date(instant).getTime() + TEHRAN_OFFSET_MINUTES * MS_PER_MIN);
  const [year, month, day] = gregorianToJalali(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
  return { year, month, day, hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

/** Tehran wall-clock in the Jalali calendar → UTC instant. */
export function jalaliToInstant(p: JalaliDateTime): Date {
  const [gy, gm, gd] = jalaliToGregorian(p.year, p.month, p.day);
  return new Date(Date.UTC(gy, gm - 1, gd, p.hour, p.minute) - TEHRAN_OFFSET_MINUTES * MS_PER_MIN);
}

/** 0 = شنبه … 6 = جمعه, for the Tehran calendar day of the given Jalali date. */
export function jalaliWeekday(jy: number, jm: number, jd: number): number {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const dow = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay(); // 0 = Sunday
  return (dow + 1) % 7;
}

/** UTC instants bounding a whole Jalali month in Tehran time: [start, end). */
export function jalaliMonthRange(jy: number, jm: number): { start: Date; end: Date } {
  const start = jalaliToInstant({ year: jy, month: jm, day: 1, hour: 0, minute: 0 });
  const ny = jm === 12 ? jy + 1 : jy;
  const nm = jm === 12 ? 1 : jm + 1;
  const end = jalaliToInstant({ year: ny, month: nm, day: 1, hour: 0, minute: 0 });
  return { start, end };
}
