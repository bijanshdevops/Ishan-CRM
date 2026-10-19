import { describe, expect, it } from 'vitest';
import {
  gregorianToJalali,
  instantToJalali,
  isJalaliLeapYear,
  jalaliMonthLength,
  jalaliMonthRange,
  jalaliToGregorian,
  jalaliToInstant,
  jalaliWeekday,
} from './jalali';

describe('jalali calendar', () => {
  it('converts known dates', () => {
    expect(gregorianToJalali(2026, 3, 21)).toEqual([1405, 1, 1]);
    expect(gregorianToJalali(2026, 10, 19)).toEqual([1405, 7, 27]);
    expect(gregorianToJalali(2027, 3, 21)).toEqual([1406, 1, 1]);
    expect(jalaliToGregorian(1405, 1, 1)).toEqual([2026, 3, 21]);
    expect(jalaliToGregorian(1406, 1, 1)).toEqual([2027, 3, 21]);
  });

  it('round-trips every day of several years', () => {
    for (let jy = 1400; jy <= 1410; jy++) {
      for (let jm = 1; jm <= 12; jm++) {
        for (let jd = 1; jd <= jalaliMonthLength(jy, jm); jd++) {
          const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
          expect(gregorianToJalali(gy, gm, gd)).toEqual([jy, jm, jd]);
        }
      }
    }
  });

  it('knows month lengths and leap years', () => {
    expect(jalaliMonthLength(1405, 1)).toBe(31);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(isJalaliLeapYear(1404)).toBe(false);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1405, 12)).toBe(29);
  });

  it('maps UTC instants to Tehran wall-clock and back', () => {
    // 2026-10-19T20:00:00Z is 23:30 in Tehran
    expect(instantToJalali('2026-10-19T20:00:00Z')).toEqual({
      year: 1405,
      month: 7,
      day: 27,
      hour: 23,
      minute: 30,
    });
    // 21:00Z crosses midnight in Tehran
    expect(instantToJalali('2026-10-19T21:00:00Z')).toMatchObject({
      month: 7,
      day: 28,
      hour: 0,
      minute: 30,
    });
    const p = { year: 1405, month: 7, day: 28, hour: 9, minute: 15 };
    expect(instantToJalali(jalaliToInstant(p))).toEqual(p);
    expect(jalaliToInstant(p).toISOString()).toBe('2026-10-20T05:45:00.000Z');
  });

  it('computes Saturday-first weekdays and month ranges', () => {
    // 2026-10-19 is a Monday → دوشنبه (index 2)
    expect(jalaliWeekday(1405, 7, 27)).toBe(2);
    expect(jalaliWeekday(1405, 1, 1)).toBe(0); // 2026-03-21 is a Saturday → شنبه
    const { start, end } = jalaliMonthRange(1405, 7);
    expect(start.toISOString()).toBe('2026-09-22T20:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-22T20:30:00.000Z');
  });
});
