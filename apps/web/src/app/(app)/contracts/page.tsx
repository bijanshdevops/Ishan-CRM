'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CONTRACT_STATUSES,
  type ContractDto,
  type ContractStatus,
  type Page,
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

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
export const CONTRACT_TONE: Record<ContractStatus, 'neutral' | 'brand' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  COMPLETED: 'brand',
  TERMINATED: 'danger',
};

export default function ContractsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  const list = useInfiniteQuery({
    queryKey: ['contracts', applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: '25' });
      if (applied.q) sp.set('q', applied.q);
      if (applied.status) sp.set('status', applied.status);
      if (pageParam) sp.set('cursor', pageParam);
      return api<Page<ContractDto>>(`/contracts?${sp.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title={fa.contracts.title} />
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ q, status });
        }}
      >
        <Field label={fa.common.search}>
          {(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <Field label={fa.contracts.status}>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">—</option>
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {fa.contracts.statuses[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
          <EmptyState>{fa.contracts.empty}</EmptyState>
        ) : (
          <DataTable
            head={[
              fa.contracts.number,
              fa.contracts.contractTitle,
              fa.contracts.customer,
              fa.contracts.amount,
              fa.contracts.startDate,
              fa.contracts.status,
            ]}
          >
            {items.map((c) => (
              <Tr key={c.id}>
                <Td className="">
                  <Link href={`/contracts/${c.id}`} className="font-medium hover:underline">
                    {c.number}
                  </Link>
                </Td>
                <Td>{c.title}</Td>
                <Td>{c.customer.name}</Td>
                <Td className="">{formatMoney(BigInt(c.amount), 'toman')}</Td>
                <Td>{formatJalaliDate(c.startDate)}</Td>
                <Td>
                  <Badge tone={CONTRACT_TONE[c.status]}>{fa.contracts.statuses[c.status]}</Badge>
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
