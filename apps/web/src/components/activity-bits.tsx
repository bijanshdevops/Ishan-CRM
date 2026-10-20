'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, type ReactNode } from 'react';
import type { ActivityDto, ActivityType } from '@ishan/contracts';
import { fa, formatJalaliDateTime } from '@ishan/i18n';
import { Badge } from './ui';

const ICONS: Record<ActivityType, ReactNode> = {
  CALL: (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  ),
  MEETING: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6" />
    </>
  ),
  TASK: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  NOTE: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
};

export function ActivityIcon({ type, className = '' }: { type: ActivityType; className?: string }) {
  return (
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
      className={className}
    >
      {ICONS[type]}
    </svg>
  );
}

export function ActivityStatusBadge({ a }: { a: Pick<ActivityDto, 'status' | 'overdue'> }) {
  if (a.overdue) return <Badge tone="danger">{fa.activities.overdue}</Badge>;
  if (a.status === 'DONE') return <Badge tone="success">{fa.activities.statuses.DONE}</Badge>;
  if (a.status === 'CANCELED') return <Badge>{fa.activities.statuses.CANCELED}</Badge>;
  return <Badge tone="brand">{fa.activities.statuses.PLANNED}</Badge>;
}

export function activityWhen(a: ActivityDto): string {
  if (a.status === 'DONE' && a.completedAt) return formatJalaliDateTime(a.completedAt);
  if (a.dueAt) return formatJalaliDateTime(a.dueAt);
  return '—';
}

/** Everything that shows activities must refresh together after any change. */
export function useRefreshActivities() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      ['activities', 'calendar', 'timeline', 'reminders', 'customer-upcoming'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
  }, [qc]);
}
