'use client';

import { useId, useMemo, useState } from 'react';
import {
  JALALI_MONTHS,
  fa,
  formatNumber,
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
} from '@ishan/i18n';
import { Button, Select } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

/** Jalali calendar date editor that emits a Gregorian `YYYY-MM-DD` (or '' while incomplete/cleared). */
export function JalaliDateField({
  label,
  value,
  onChange,
  optional,
  error,
  yearsBack = 1,
  yearsAhead = 5,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
  optional?: boolean;
  error?: string;
  yearsBack?: number;
  yearsAhead?: number;
}) {
  const legendId = useId();
  const nowYear = useMemo(() => {
    const t = new Date(Date.now() + 210 * 60_000).toISOString().slice(0, 10).split('-').map(Number);
    return gregorianToJalali(t[0]!, t[1]!, t[2]!)[0];
  }, []);
  const init = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }, [value]);
  const [y, setY] = useState(init ? String(init[0]) : '');
  const [m, setM] = useState(init ? String(init[1]) : '');
  const [d, setD] = useState(init ? String(init[2]) : '');

  const years = useMemo(() => {
    const list: number[] = [];
    for (let i = nowYear - yearsBack; i <= nowYear + yearsAhead; i++) list.push(i);
    if (init && !list.includes(init[0])) list.unshift(init[0]);
    return list;
  }, [nowYear, yearsBack, yearsAhead, init]);
  const maxDay = y && m ? jalaliMonthLength(Number(y), Number(m)) : 31;

  const emit = (ny: string, nm: string, nd: string) => {
    if (!ny || !nm || !nd) return onChange('');
    const day = Math.min(Number(nd), jalaliMonthLength(Number(ny), Number(nm)));
    const [gy, gm, gd] = jalaliToGregorian(Number(ny), Number(nm), day);
    onChange(`${gy}-${pad(gm)}-${pad(gd)}`);
  };

  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error ? `${legendId}-err` : undefined}>
      <legend id={legendId} className="mb-1.5 text-sm font-medium">
        {label}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`${label} — ${fa.activities.day}`}
          value={d}
          onChange={(e) => {
            setD(e.target.value);
            emit(y, m, e.target.value);
          }}
          className="!w-24"
        >
          <option value="">{fa.activities.day}</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {formatNumber(n)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={`${label} — ${fa.activities.month}`}
          value={m}
          onChange={(e) => {
            setM(e.target.value);
            emit(y, e.target.value, d);
          }}
          className="!w-32"
        >
          <option value="">{fa.activities.month}</option>
          {JALALI_MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={`${label} — ${fa.activities.year}`}
          value={y}
          onChange={(e) => {
            setY(e.target.value);
            emit(e.target.value, m, d);
          }}
          className="!w-28"
        >
          <option value="">{fa.activities.year}</option>
          {years.map((n) => (
            <option key={n} value={n}>
              {new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n)}
            </option>
          ))}
        </Select>
        {optional && value ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setY('');
              setM('');
              setD('');
              onChange('');
            }}
          >
            {fa.activities.clear}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p id={`${legendId}-err`} role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
