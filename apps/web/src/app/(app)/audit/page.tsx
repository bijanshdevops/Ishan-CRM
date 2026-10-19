'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Page } from '@ishan/contracts';
import { fa, formatJalaliDateTime } from '@ishan/i18n';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Input,
  PageHeader,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { api } from '@/lib/api';

interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [filter, setFilter] = useState('');
  const [action, setAction] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['audit', action],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<AuditRow>>(
        `/audit-logs?limit=50${action ? `&action=${encodeURIComponent(action)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title={fa.audit.title} />
      <Card>
        <form
          role="search"
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAction(filter.trim());
          }}
        >
          <div className="grow">
            <Input
              dir="ltr"
              aria-label={fa.audit.action}
              placeholder={fa.audit.filterAction}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            {fa.common.search}
          </Button>
        </form>
        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorBanner message={fa.common.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            head={[fa.audit.time, fa.audit.action, fa.audit.entity, fa.audit.actor, fa.audit.ip]}
          >
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>{formatJalaliDateTime(r.createdAt)}</Td>
                <Td className="[direction:ltr] text-end font-mono text-xs">{r.action}</Td>
                <Td className="[direction:ltr] text-end text-xs">
                  {r.entityType}
                  {r.entityId ? `:${r.entityId.slice(0, 8)}` : ''}
                </Td>
                <Td className="[direction:ltr] text-end text-xs">
                  {r.actorId ? r.actorId.slice(0, 8) : 'system'}
                </Td>
                <Td className="[direction:ltr] text-end text-xs">{r.ip ?? '—'}</Td>
              </Tr>
            ))}
          </DataTable>
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
    </>
  );
}
