'use client';

import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  PERMISSIONS,
  type ActivityDto,
  type NotificationDto,
  type Page,
  type UnreadCountDto,
} from '@ishan/contracts';
import { fa, formatJalaliDateTime, formatNumber } from '@ishan/i18n';
import { api, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notificationHref } from '@/lib/notification-links';
import { ActivityIcon, useRefreshActivities } from './activity-bits';
import { useToast } from './toast';
import { Button, Modal } from './ui';

const POLL_MS = 60_000;
const linkClass =
  'inline-flex min-h-8 items-center rounded-[var(--radius-md)] px-3 text-sm text-[var(--color-brand)] hover:underline';

/**
 * Bell with the user's notifications and due reminders; polls once a minute and on window focus.
 * Notifications are everyone's own inbox (no permission); reminders need `activities.read`.
 */
export function ReminderBell() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefreshActivities();
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const lastUnread = useRef<number | null>(null);
  const canReminders = can(PERMISSIONS.ACTIVITIES_READ);

  const reminders = useQuery({
    queryKey: ['reminders'],
    enabled: canReminders,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    queryFn: () => api<ActivityDto[]>('/activities/reminders/due'),
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    queryFn: () => api<UnreadCountDto>('/notifications/unread-count'),
  });
  const list = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    enabled: open,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p: Page<NotificationDto>) => p.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      api<Page<NotificationDto>>(
        `/notifications?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
  });

  const items = reminders.data ?? [];
  const notifications = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = unread.data?.count ?? 0;
  const badge = items.length + unreadCount;

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

  // Same for notifications: only a rise after the first load is news.
  useEffect(() => {
    if (!unread.data) return;
    if (lastUnread.current !== null && unread.data.count > lastUnread.current) {
      toast(fa.notifications.newOne);
      void qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
    }
    lastUnread.current = unread.data.count;
  }, [unread.data, toast, qc]);

  const onError = (e: unknown) =>
    toast(e instanceof ApiClientError ? e.message : fa.common.error, 'error');
  const refreshNotifications = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/activities/${id}/reminder/dismiss`, { method: 'POST' }),
    onSuccess: refresh,
    onError,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: refreshNotifications,
    onError,
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: refreshNotifications,
    onError,
  });

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`${fa.notifications.bell}${badge ? `: ${formatNumber(badge)}` : ''}`}
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
        {badge > 0 ? (
          <span className="absolute -top-0.5 end-0 min-w-4 rounded-full bg-[var(--color-danger)] px-1 text-[10px] leading-4 text-[var(--color-brand-contrast)]">
            {formatNumber(badge)}
          </span>
        ) : null}
      </Button>
      {open ? (
        <Modal title={fa.notifications.bell} onClose={() => setOpen(false)}>
          <section aria-label={fa.notifications.title}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{fa.notifications.title}</h3>
              {unreadCount > 0 ? (
                <Button
                  variant="secondary"
                  className="min-h-8 px-3"
                  loading={markAll.isPending}
                  onClick={() => markAll.mutate()}
                >
                  {fa.notifications.markAllRead}
                </Button>
              ) : null}
            </div>
            {list.isLoading ? (
              <p className="py-3 text-sm text-[var(--color-text-muted)]">{fa.common.loading}</p>
            ) : notifications.length === 0 ? (
              <p className="py-3 text-sm text-[var(--color-text-muted)]">
                {fa.notifications.empty}
              </p>
            ) : (
              <ul>
                {notifications.map((n) => {
                  const href = notificationHref(n, can);
                  return (
                    <li
                      key={n.id}
                      className="border-b border-[var(--color-border)] py-3 last:border-b-0"
                    >
                      <p className={n.read ? '' : 'font-medium'}>
                        {n.read ? null : (
                          <span className="sr-only">{fa.notifications.unread}: </span>
                        )}
                        {n.title}
                      </p>
                      {n.body ? (
                        <p className="whitespace-pre-line text-sm text-[var(--color-text-muted)]">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatJalaliDateTime(n.createdAt)}
                      </p>
                      <div className="mt-2 flex gap-2">
                        {n.read ? null : (
                          <Button
                            variant="secondary"
                            className="min-h-8 px-3"
                            loading={markRead.isPending && markRead.variables === n.id}
                            onClick={() => markRead.mutate(n.id)}
                          >
                            {fa.notifications.markRead}
                          </Button>
                        )}
                        {href ? (
                          <Link
                            href={href}
                            className={linkClass}
                            onClick={() => {
                              if (!n.read) markRead.mutate(n.id);
                              setOpen(false);
                            }}
                          >
                            {fa.notifications.open}
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.hasNextPage ? (
              <Button
                variant="ghost"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {fa.common.more}
              </Button>
            ) : null}
          </section>
          {canReminders ? (
            <section aria-label={fa.activities.reminders} className="mt-4">
              <h3 className="text-sm font-semibold">{fa.activities.reminders}</h3>
              {items.length === 0 ? (
                <p className="py-3 text-sm text-[var(--color-text-muted)]">
                  {fa.activities.remindersEmpty}
                </p>
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
                          <Link
                            href={
                              a.customer && can(PERMISSIONS.CUSTOMERS_READ)
                                ? `/customers/${a.customer.id}`
                                : '/activities'
                            }
                            onClick={() => setOpen(false)}
                            className={linkClass}
                          >
                            {fa.activities.openActivity}
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
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
