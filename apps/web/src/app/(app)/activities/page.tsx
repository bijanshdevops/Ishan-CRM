'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PERMISSIONS, type ActivityDto, type Page } from '@ishan/contracts';
import { fa, instantToJalali, jalaliToInstant } from '@ishan/i18n';
import { ActivityFormDialog } from '@/components/activity-form';
import { ActivityItem } from '@/components/activity-item';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Tab = 'today' | 'overdue' | 'upcoming' | 'done';
const TABS: Tab[] = ['today', 'overdue', 'upcoming', 'done'];
const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

/** Start of the current Tehran day as a UTC instant. */
function dayBounds() {
  const p = instantToJalali(new Date());
  const start = jalaliToInstant({ ...p, hour: 0, minute: 0 });
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}

export default function ActivitiesPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.ACTIVITIES_WRITE);
  const [tab, setTab] = useState<Tab>('today');
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [creating, setCreating] = useState(false);
  const bounds = useMemo(() => dayBounds(), []);

  const list = useInfiniteQuery({
    queryKey: ['activities', tab, scope, type, applied],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: '25' });
      if (scope === 'me') sp.set('assigneeId', 'me');
      if (type) sp.set('type', type);
      if (applied) sp.set('q', applied);
      if (tab === 'today') {
        sp.set('status', 'PLANNED');
        sp.set('from', bounds.start);
        sp.set('to', bounds.end);
        sp.set('sort', 'due');
      } else if (tab === 'overdue') {
        sp.set('overdue', 'true');
        sp.set('sort', 'due');
      } else if (tab === 'upcoming') {
        sp.set('status', 'PLANNED');
        sp.set('from', bounds.end);
        sp.set('sort', 'due');
      } else {
        sp.set('status', 'DONE');
      }
      if (pageParam) sp.set('cursor', pageParam);
      return api<Page<ActivityDto>>(`/activities?${sp.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={fa.activities.title}
        actions={
          canWrite ? (
            <Button onClick={() => setCreating(true)}>{fa.activities.add}</Button>
          ) : undefined
        }
      />
      <Card>
        <div role="tablist" aria-label={fa.activities.title} className="mb-4 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-10 rounded-[var(--radius-md)] px-4 text-sm focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none ${
                tab === t
                  ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                  : 'hover:bg-[var(--color-surface-2)]'
              }`}
            >
              {fa.activities.tabs[t]}
            </button>
          ))}
        </div>
        <form
          role="search"
          className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q.trim());
          }}
        >
          <Input
            aria-label={fa.common.search}
            placeholder={fa.activities.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            aria-label={fa.activities.type}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">{fa.activities.allTypes}</option>
            {Object.entries(fa.activities.types).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select
            aria-label={fa.activities.assignee}
            value={scope}
            onChange={(e) => setScope(e.target.value as 'me' | 'all')}
          >
            <option value="me">{fa.activities.mine}</option>
            <option value="all">{fa.activities.everyone}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {fa.common.search}
          </Button>
        </form>
        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState>{fa.activities.empty}</EmptyState>
        ) : (
          <ul>
            {items.map((a) => (
              <ActivityItem key={a.id} a={a} />
            ))}
          </ul>
        )}
        {list.hasNextPage ? (
          <div className="mt-4 text-center">
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {fa.common.more}
            </Button>
          </div>
        ) : null}
      </Card>
      {creating ? <ActivityFormDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
