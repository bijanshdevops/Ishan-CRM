'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PERMISSIONS, type ActivityDto, type CalendarDto } from '@ishan/contracts';
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  fa,
  formatNumber,
  instantToJalali,
  jalaliMonthLength,
  jalaliMonthRange,
  jalaliWeekday,
} from '@ishan/i18n';
import { ActivityFormDialog } from '@/components/activity-form';
import { ActivityIcon } from '@/components/activity-bits';
import { ActivityItem } from '@/components/activity-item';
import { Button, Card, ErrorBanner, Modal, PageHeader, Select, Skeleton } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
const faYear = (y: number) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(y);

export default function CalendarPage() {
  const { can } = useAuth();
  const now = useMemo(() => instantToJalali(new Date()), []);
  const [cursor, setCursor] = useState({ year: now.year, month: now.month });
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const { start, end } = useMemo(
    () => jalaliMonthRange(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );
  const data = useQuery({
    queryKey: ['calendar', cursor.year, cursor.month, scope],
    queryFn: () => {
      const sp = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });
      if (scope === 'me') sp.set('assigneeId', 'me');
      return api<CalendarDto>(`/activities/calendar?${sp.toString()}`);
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<number, ActivityDto[]>();
    for (const a of data.data?.items ?? []) {
      if (!a.dueAt) continue;
      const { day } = instantToJalali(a.dueAt);
      map.set(day, [...(map.get(day) ?? []), a]);
    }
    return map;
  }, [data.data]);

  const days = jalaliMonthLength(cursor.year, cursor.month);
  const lead = jalaliWeekday(cursor.year, cursor.month, 1);
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const shift = (delta: number) =>
    setCursor((c) => {
      const idx = c.year * 12 + (c.month - 1) + delta;
      return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
    });
  const isToday = (d: number) =>
    cursor.year === now.year && cursor.month === now.month && d === now.day;
  const title = `${JALALI_MONTHS[cursor.month - 1]} ${faYear(cursor.year)}`;
  const dayItems = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <>
      <PageHeader
        title={fa.calendar.title}
        actions={
          can(PERMISSIONS.ACTIVITIES_WRITE) ? (
            <Button onClick={() => setCreating(true)}>{fa.activities.add}</Button>
          ) : undefined
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => shift(-1)}>
              {fa.calendar.prev}
            </Button>
            <h2 aria-live="polite" className="min-w-36 text-center text-lg font-semibold">
              {title}
            </h2>
            <Button variant="secondary" onClick={() => shift(1)}>
              {fa.calendar.next}
            </Button>
            <Button variant="ghost" onClick={() => setCursor({ year: now.year, month: now.month })}>
              {fa.calendar.today}
            </Button>
          </div>
          <Select
            aria-label={fa.activities.assignee}
            className="sm:w-48"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'me' | 'all')}
          >
            <option value="me">{fa.activities.mine}</option>
            <option value="all">{fa.activities.everyone}</option>
          </Select>
        </div>
        {data.isError ? (
          <ErrorBanner message={msg(data.error)} onRetry={() => void data.refetch()} />
        ) : null}
        {data.data?.truncated ? (
          <p
            role="status"
            className="mb-3 text-sm text-[var(--color-warning,var(--color-text-muted))]"
          >
            {fa.calendar.truncated}
          </p>
        ) : null}
        {data.isLoading ? (
          <Skeleton rows={6} />
        ) : (
          <table className="w-full table-fixed border-collapse text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {JALALI_WEEKDAYS.map((w, i) => (
                  <th
                    key={w}
                    scope="col"
                    className={`p-1 text-xs font-medium sm:p-2 ${
                      i === 6 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    <span className="sm:hidden">{w.slice(0, 1)}</span>
                    <span className="max-sm:hidden">{w}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((d, di) => {
                    if (d === null) {
                      return (
                        <td
                          key={di}
                          className="border border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
                        />
                      );
                    }
                    const items = byDay.get(d) ?? [];
                    return (
                      <td key={di} className="border border-[var(--color-border)] p-0 align-top">
                        <button
                          type="button"
                          onClick={() => setOpenDay(d)}
                          aria-label={`${formatNumber(d)} ${JALALI_MONTHS[cursor.month - 1]}، ${formatNumber(items.length)} ${fa.activities.title}`}
                          className={`flex h-16 w-full flex-col items-stretch gap-1 p-1 text-start hover:bg-[var(--color-surface-2)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none sm:h-28 sm:p-2 ${
                            di === 6 ? 'text-[var(--color-danger)]' : ''
                          }`}
                        >
                          <span
                            className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${
                              isToday(d)
                                ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                                : ''
                            }`}
                          >
                            {formatNumber(d)}
                          </span>
                          <span className="hidden flex-col gap-0.5 text-[var(--color-text)] sm:flex">
                            {items.slice(0, 2).map((a) => (
                              <span
                                key={a.id}
                                className={`flex items-center gap-1 truncate rounded px-1 text-xs ${
                                  a.overdue
                                    ? 'bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)]'
                                    : 'bg-[color-mix(in_srgb,var(--color-brand)_14%,transparent)]'
                                }`}
                              >
                                <ActivityIcon type={a.type} className="size-3.5 shrink-0" />
                                <span className="truncate">{a.title}</span>
                              </span>
                            ))}
                            {items.length > 2 ? (
                              <span className="text-xs text-[var(--color-text-muted)]">
                                +{formatNumber(items.length - 2)} {fa.calendar.moreItems}
                              </span>
                            ) : null}
                          </span>
                          {items.length > 0 ? (
                            <span className="mx-auto rounded-full bg-[var(--color-brand)] px-1.5 text-[10px] text-[var(--color-brand-contrast)] sm:hidden">
                              {formatNumber(items.length)}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {openDay ? (
        <Modal
          title={`${fa.calendar.dayDialog} ${formatNumber(openDay)} ${JALALI_MONTHS[cursor.month - 1]}`}
          onClose={() => setOpenDay(null)}
        >
          {dayItems.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">{fa.calendar.noItems}</p>
          ) : (
            <ul>
              {dayItems.map((a) => (
                <ActivityItem key={a.id} a={a} />
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setOpenDay(null)}>
              {fa.common.close}
            </Button>
          </div>
        </Modal>
      ) : null}
      {creating ? <ActivityFormDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
