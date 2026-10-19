'use client';

import { useId, useMemo, useState } from 'react';
import {
  JALALI_MONTHS,
  fa,
  formatNumber,
  instantToJalali,
  jalaliMonthLength,
  jalaliToInstant,
} from '@ishan/i18n';
import { Button, Input, Select } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Jalali date + 24h time (Tehran) editor. Emits a UTC ISO instant, or '' while the
 * value is incomplete or cleared. Built from selects so it is keyboard- and
 * screen-reader-friendly and never depends on the browser's Gregorian date input.
 */
export function JalaliDateTimeField({
  label,
  value,
  onChange,
  optional,
  error,
  defaultTime = '09:00',
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  optional?: boolean;
  error?: string;
  defaultTime?: string;
}) {
  const legendId = useId();
  const nowYear = useMemo(() => instantToJalali(new Date()).year, []);
  const init = value ? instantToJalali(value) : null;
  const [y, setY] = useState(init ? String(init.year) : '');
  const [m, setM] = useState(init ? String(init.month) : '');
  const [d, setD] = useState(init ? String(init.day) : '');
  const [t, setT] = useState(init ? `${pad(init.hour)}:${pad(init.minute)}` : defaultTime);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let i = nowYear - 1; i <= nowYear + 5; i++) list.push(i);
    if (init && !list.includes(init.year)) list.unshift(init.year);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowYear, init?.year]);

  const maxDay = y && m ? jalaliMonthLength(Number(y), Number(m)) : 31;

  const emit = (ny: string, nm: string, nd: string, nt: string) => {
    if (!ny || !nm || !nd || !/^\d{2}:\d{2}$/.test(nt)) return onChange('');
    const len = jalaliMonthLength(Number(ny), Number(nm));
    const day = Math.min(Number(nd), len);
    const [hh, mm] = nt.split(':').map(Number);
    onChange(
      jalaliToInstant({
        year: Number(ny),
        month: Number(nm),
        day,
        hour: hh!,
        minute: mm!,
      }).toISOString(),
    );
  };

  const set = (k: 'y' | 'm' | 'd' | 't', v: string) => {
    const next = { y, m, d, t, [k]: v };
    if (k === 'm' || k === 'y') {
      if (next.y && next.m && Number(next.d) > jalaliMonthLength(Number(next.y), Number(next.m))) {
        next.d = String(jalaliMonthLength(Number(next.y), Number(next.m)));
      }
    }
    setY(next.y);
    setM(next.m);
    setD(next.d);
    setT(next.t);
    emit(next.y, next.m, next.d, next.t);
  };

  return (
    <fieldset aria-labelledby={legendId} className="flex min-w-0 flex-col gap-1.5">
      <legend id={legendId} className="mb-1.5 text-sm font-medium">
        {label}
      </legend>
      <div className="grid grid-cols-[1fr_2fr_1.4fr_1.6fr_auto] gap-2 max-sm:grid-cols-3">
        <Select aria-label={fa.activities.day} value={d} onChange={(e) => set('d', e.target.value)}>
          <option value="">{fa.activities.day}</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {formatNumber(n)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={fa.activities.month}
          value={m}
          onChange={(e) => set('m', e.target.value)}
        >
          <option value="">{fa.activities.month}</option>
          {JALALI_MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={fa.activities.year}
          value={y}
          onChange={(e) => set('y', e.target.value)}
        >
          <option value="">{fa.activities.year}</option>
          {years.map((n) => (
            <option key={n} value={n}>
              {new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n)}
            </option>
          ))}
        </Select>
        <Input
          type="time"
          dir="ltr"
          aria-label={fa.activities.time}
          value={t}
          onChange={(e) => set('t', e.target.value)}
        />
        {optional ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setY('');
              setM('');
              setD('');
              setT(defaultTime);
              onChange('');
            }}
          >
            {fa.activities.clear}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
