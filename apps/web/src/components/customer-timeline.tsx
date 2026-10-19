'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PERMISSIONS,
  type ActivityDto,
  type ActivityType,
  type Page,
  type TimelinePageDto,
} from '@ishan/contracts';
import { fa, formatJalaliDateTime } from '@ishan/i18n';
import { api, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ActivityFormDialog, type ActivityDefaults } from './activity-form';
import { ActivityItem } from './activity-item';
import { Button, Card, EmptyState, ErrorBanner, Skeleton } from './ui';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

/** Upcoming work and the interaction history on a customer's file. */
export function CustomerActivities({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const { can } = useAuth();
  const [form, setForm] = useState<ActivityDefaults | null>(null);
  const canWrite = can(PERMISSIONS.ACTIVITIES_WRITE);
  const base = { customer: { id: customerId, name: customerName } };

  const upcoming = useQuery({
    queryKey: ['customer-upcoming', customerId],
    queryFn: () =>
      api<Page<ActivityDto>>(
        `/activities?customerId=${customerId}&status=PLANNED&sort=due&limit=10`,
      ),
  });
  const timeline = useInfiniteQuery({
    queryKey: ['timeline', customerId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<TimelinePageDto>(
        `/customers/${customerId}/timeline?limit=20${
          pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  });
  const entries = timeline.data?.pages.flatMap((p) => p.items) ?? [];

  const add = (type: ActivityType, logPast = false) => setForm({ ...base, type, logPast });

  return (
    <>
      <Card
        title={fa.activities.upcomingWork}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => add('TASK')}>
                {fa.activities.addTask}
              </Button>
              <Button variant="secondary" onClick={() => add('MEETING')}>
                {fa.activities.addMeeting}
              </Button>
            </div>
          ) : undefined
        }
      >
        {upcoming.isLoading ? (
          <Skeleton rows={2} />
        ) : upcoming.isError ? (
          <ErrorBanner message={msg(upcoming.error)} onRetry={() => void upcoming.refetch()} />
        ) : upcoming.data?.items.length ? (
          <ul>
            {upcoming.data.items.map((a) => (
              <ActivityItem key={a.id} a={a} showCustomer={false} />
            ))}
          </ul>
        ) : (
          <EmptyState>{fa.activities.empty}</EmptyState>
        )}
      </Card>

      <Card
        title={fa.activities.timeline}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => add('NOTE')}>
                {fa.activities.addNote}
              </Button>
              <Button variant="secondary" onClick={() => add('CALL', true)}>
                {fa.activities.addCall}
              </Button>
            </div>
          ) : undefined
        }
      >
        {timeline.isLoading ? (
          <Skeleton rows={3} />
        ) : timeline.isError ? (
          <ErrorBanner message={msg(timeline.error)} onRetry={() => void timeline.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState>{fa.activities.timelineEmpty}</EmptyState>
        ) : (
          <ul>
            {entries.map((e) =>
              e.kind === 'activity' ? (
                <ActivityItem key={e.id} a={e.activity} showCustomer={false} />
              ) : (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] py-3 text-sm last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className="ms-1.5 size-2 rounded-full bg-[var(--color-brand)]"
                  />
                  <span>
                    {e.fromStage ? fa.activities.stageChange : fa.activities.stageCreated}{' '}
                    <strong>{e.deal.title}</strong>
                    {e.fromStage ? (
                      <>
                        : {e.fromStage} ← {e.toStage}
                      </>
                    ) : (
                      <>: {e.toStage}</>
                    )}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {formatJalaliDateTime(e.occurredAt)}
                    {e.actor ? ` · ${fa.activities.by} ${e.actor.name}` : ''}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
        {timeline.hasNextPage ? (
          <div className="mt-4 text-center">
            <Button
              variant="secondary"
              loading={timeline.isFetchingNextPage}
              onClick={() => void timeline.fetchNextPage()}
            >
              {fa.activities.loadMore}
            </Button>
          </div>
        ) : null}
      </Card>
      {form ? <ActivityFormDialog defaults={form} onClose={() => setForm(null)} /> : null}
    </>
  );
}
