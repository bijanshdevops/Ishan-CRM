'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PERMISSIONS,
  QUOTE_STATUSES,
  type Page,
  type QuoteStatus,
  type QuoteSummaryDto,
} from '@ishan/contracts';
import { fa, formatJalaliDate, formatMoney } from '@ishan/i18n';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
export const QUOTE_TONE: Record<QuoteStatus, 'neutral' | 'brand' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'brand',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
};

export default function QuotesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState(false);
  const [applied, setApplied] = useState({ q: '', status: '', history: false });

  const list = useInfiniteQuery({
    queryKey: ['quotes', applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: '25', history: String(applied.history) });
      if (applied.q) sp.set('q', applied.q);
      if (applied.status) sp.set('status', applied.status);
      if (pageParam) sp.set('cursor', pageParam);
      return api<Page<QuoteSummaryDto>>(`/quotes?${sp.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={fa.quotes.title}
        actions={
          can(PERMISSIONS.QUOTES_WRITE) ? (
            <Link
              href="/quotes/new"
              className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-brand-contrast)]"
            >
              {fa.quotes.add}
            </Link>
          ) : undefined
        }
      />
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ q, status, history });
        }}
      >
        <Field label={fa.common.search}>
          {(p) => (
            <Input
              {...p}
              value={q}
              placeholder={fa.quotes.searchPlaceholder}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.quotes.status}>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">—</option>
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {fa.quotes.statuses[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
          {fa.quotes.history}
        </label>
        <Button type="submit" variant="secondary">
          {fa.common.search}
        </Button>
      </form>
      <Card>
        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.quotes.number,
              fa.quotes.quoteTitle,
              fa.quotes.customer,
              fa.quotes.issueDate,
              fa.quotes.total,
              fa.quotes.status,
            ]}
          >
            {items.map((r) => (
              <Tr key={r.id}>
                <Td className="tabular-nums">
                  <Link href={`/quotes/${r.id}`} className="font-medium hover:underline">
                    {r.number}
                  </Link>
                  {r.version > 1 ? ` · ${fa.quotes.version} ${r.version}` : ''}
                </Td>
                <Td>{r.title}</Td>
                <Td>
                  <Link href={`/customers/${r.customer.id}`} className="hover:underline">
                    {r.customer.name}
                  </Link>
                </Td>
                <Td>{formatJalaliDate(r.issueDate)}</Td>
                <Td className="tabular-nums">{formatMoney(BigInt(r.total), 'toman')}</Td>
                <Td>
                  <Badge tone={QUOTE_TONE[r.status]}>{fa.quotes.statuses[r.status]}</Badge>
                  {r.expired ? <Badge tone="danger">{fa.quotes.expired}</Badge> : null}
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
        {list.hasNextPage ? (
          <div className="mt-3 text-center">
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
