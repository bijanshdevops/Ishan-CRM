'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { PERMISSIONS, type ActivityDto } from '@ishan/contracts';
import { fa, formatJalaliDateTime, formatNumber } from '@ishan/i18n';
import { api, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ActivityIcon, useRefreshActivities } from './activity-bits';
import { useToast } from './toast';
import { Button, Modal } from './ui';

const POLL_MS = 60_000;

/** Bell with the user's due reminders; polls once a minute and on window focus. */
export function ReminderBell() {
  const { can } = useAuth();
  const toast = useToast();
  const refresh = useRefreshActivities();
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const enabled = can(PERMISSIONS.ACTIVITIES_READ);

  const reminders = useQuery({
    queryKey: ['reminders'],
    enabled,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    queryFn: () => api<ActivityDto[]>('/activities/reminders/due'),
  });
  const items = reminders.data ?? [];

  // Announce reminders that came due while the app is open (not the ones already waiting at load).
  useEffect(() => {
    if (!reminders.data) return;
    const ids = new Set(reminders.data.map((a) => a.id));
    if (seen.current) {
      for (const a of reminders.data) {
        if (!seen.current.has(a.id)) toast(`${fa.activities.reminders}: ${a.title}`);
      }
    }
    seen.current = ids;
  }, [reminders.data, toast]);

  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/activities/${id}/reminder/dismiss`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (e) => toast(e instanceof ApiClientError ? e.message : fa.common.error, 'error'),
  });

  if (!enabled) return null;
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`${fa.activities.reminders}${items.length ? `: ${formatNumber(items.length)}` : ''}`}
        className="relative"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {items.length > 0 ? (
          <span className="absolute -top-0.5 end-0 min-w-4 rounded-full bg-[var(--color-danger)] px-1 text-[10px] leading-4 text-white">
            {formatNumber(items.length)}
          </span>
        ) : null}
      </Button>
      {open ? (
        <Modal title={fa.activities.reminders} onClose={() => setOpen(false)}>
          {items.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">{fa.activities.remindersEmpty}</p>
          ) : (
            <ul>
              {items.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0"
                >
                  <ActivityIcon type={a.type} className="mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {a.dueAt ? formatJalaliDateTime(a.dueAt) : ''}
                      {a.customer ? ` · ${a.customer.name}` : ''}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="secondary"
                        className="min-h-8 px-3"
                        loading={dismiss.isPending && dismiss.variables === a.id}
                        onClick={() => dismiss.mutate(a.id)}
                      >
                        {fa.activities.dismiss}
                      </Button>
                      {a.customer && can(PERMISSIONS.CUSTOMERS_READ) ? (
                        <Link
                          href={`/customers/${a.customer.id}`}
                          onClick={() => setOpen(false)}
                          className="inline-flex min-h-8 items-center rounded-[var(--radius-md)] px-3 text-sm text-[var(--color-brand)] hover:underline"
                        >
                          {fa.activities.openActivity}
                        </Link>
                      ) : (
                        <Link
                          href="/activities"
                          onClick={() => setOpen(false)}
                          className="inline-flex min-h-8 items-center rounded-[var(--radius-md)] px-3 text-sm text-[var(--color-brand)] hover:underline"
                        >
                          {fa.activities.openActivity}
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {fa.common.close}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
