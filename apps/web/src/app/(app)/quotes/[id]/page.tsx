'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type QuoteDto, type QuoteSummaryDto } from '@ishan/contracts';
import { fa, formatJalaliDate, formatMoney, formatNumber } from '@ishan/i18n';
import { QuoteForm } from '@/components/quote-form';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorBanner,
  PageHeader,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { QUOTE_TONE } from '../page';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
const toman = (rial: string) => formatMoney(BigInt(rial), 'toman');

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);

  const quote = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api<QuoteDto>(`/quotes/${id}`),
  });
  const versions = useQuery({
    queryKey: ['quote', id, 'versions'],
    queryFn: () => api<QuoteSummaryDto[]>(`/quotes/${id}/versions`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['quote'] });
    void qc.invalidateQueries({ queryKey: ['quotes'] });
  };
  const move = useMutation({
    mutationFn: (status: 'SENT' | 'ACCEPTED' | 'REJECTED') =>
      api<QuoteDto>(`/quotes/${id}/status`, { method: 'POST', body: { status } }),
    onSuccess: () => {
      toast(fa.quotes.transitioned);
      refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const revise = useMutation({
    mutationFn: () => api<QuoteDto>(`/quotes/${id}/revise`, { method: 'POST' }),
    onSuccess: (q) => {
      toast(fa.quotes.revised);
      refresh();
      router.push(`/quotes/${q.id}`);
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api(`/quotes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(fa.quotes.deleted);
      refresh();
      router.push('/quotes');
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const makeContract = useMutation({
    mutationFn: () => api<{ id: string }>('/contracts', { method: 'POST', body: { quoteId: id } }),
    onSuccess: (c) => {
      toast(fa.contracts.created);
      refresh();
      router.push(`/contracts/${c.id}`);
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  if (quote.isLoading) return <Skeleton rows={8} />;
  if (quote.isError || !quote.data)
    return <ErrorBanner message={msg(quote.error)} onRetry={() => void quote.refetch()} />;
  const q = quote.data;
  const canWrite = can(PERMISSIONS.QUOTES_WRITE);
  const latest = q.version === q.latestVersion;

  if (editing) {
    return (
      <>
        <PageHeader title={`${fa.quotes.edit} · ${q.number}`} />
        <Card>
          <QuoteForm
            quote={q}
            onSaved={() => {
              setEditing(false);
              refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${q.number}${q.version > 1 ? ` · ${fa.quotes.version} ${formatNumber(q.version)}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              {fa.quotes.print}
            </Button>
            {canWrite && q.status === 'DRAFT' ? (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {fa.common.edit}
                </Button>
                <Button loading={move.isPending} onClick={() => move.mutate('SENT')}>
                  {fa.quotes.send}
                </Button>
              </>
            ) : null}
            {canWrite && q.status === 'SENT' ? (
              <>
                <Button loading={move.isPending} onClick={() => move.mutate('ACCEPTED')}>
                  {fa.quotes.accept}
                </Button>
                <Button
                  variant="secondary"
                  loading={move.isPending}
                  onClick={() => move.mutate('REJECTED')}
                >
                  {fa.quotes.reject}
                </Button>
              </>
            ) : null}
            {canWrite && (q.status === 'SENT' || q.status === 'REJECTED') ? (
              <Button
                variant="secondary"
                loading={revise.isPending}
                onClick={() => revise.mutate()}
              >
                {fa.quotes.revise}
              </Button>
            ) : null}
            {can(PERMISSIONS.CONTRACTS_WRITE) && q.status === 'ACCEPTED' && !q.contract ? (
              <Button loading={makeContract.isPending} onClick={() => makeContract.mutate()}>
                {fa.quotes.createContract}
              </Button>
            ) : null}
            {can(PERMISSIONS.QUOTES_DELETE) && q.status === 'DRAFT' ? (
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(fa.quotes.deleteConfirm)) remove.mutate();
                }}
              >
                {fa.common.delete}
              </Button>
            ) : null}
          </div>
        }
      />

      {!latest ? (
        <p role="status" className="mb-3 text-sm text-[var(--color-text-muted)] print:hidden">
          {fa.quotes.statuses.SUPERSEDED} ·{' '}
          <Link href={`/quotes/${versions.data?.[0]?.id ?? id}`} className="underline">
            {fa.quotes.version} {formatNumber(q.latestVersion)}
          </Link>
        </p>
      ) : null}
      {q.status !== 'DRAFT' ? (
        <p className="mb-3 text-sm text-[var(--color-text-muted)] print:hidden">
          {fa.quotes.lockedHint}
        </p>
      ) : null}

      <article className="print-area flex flex-col gap-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{q.title}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {fa.quotes.customer}:{' '}
              <Link href={`/customers/${q.customer.id}`} className="hover:underline">
                {q.customer.name}
              </Link>
              {q.contact ? ` · ${q.contact.name}` : ''}
            </p>
            {q.deal ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                {fa.quotes.deal}: {q.deal.title}
              </p>
            ) : null}
          </div>
          <div className="text-sm">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={QUOTE_TONE[q.status]}>{fa.quotes.statuses[q.status]}</Badge>
              {q.expired ? <Badge tone="danger">{fa.quotes.expired}</Badge> : null}
            </div>
            <p>
              {fa.quotes.issueDate}: {formatJalaliDate(q.issueDate)}
            </p>
            {q.validUntil ? (
              <p>
                {fa.quotes.validUntil}: {formatJalaliDate(q.validUntil)}
              </p>
            ) : null}
          </div>
        </header>

        <DataTable
          head={[
            '#',
            fa.quotes.description,
            fa.quotes.quantity,
            fa.quotes.unitPrice,
            fa.quotes.lineTotal,
          ]}
        >
          {q.items.map((i, idx) => (
            <Tr key={i.id}>
              <Td>{formatNumber(idx + 1)}</Td>
              <Td>{i.description}</Td>
              <Td className="tabular-nums">{formatNumber(i.quantity)}</Td>
              <Td className="tabular-nums">{toman(i.unitPrice)}</Td>
              <Td className="tabular-nums">{toman(i.lineTotal)}</Td>
            </Tr>
          ))}
        </DataTable>

        <dl className="ms-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
          <dt>{fa.quotes.subtotal}</dt>
          <dd>{toman(q.subtotal)}</dd>
          <dt>{fa.quotes.discount}</dt>
          <dd>{toman(q.discount)}</dd>
          <dt>
            {fa.quotes.tax} ({formatNumber(q.taxRateBp / 100)}٪)
          </dt>
          <dd>{toman(q.taxAmount)}</dd>
          <dt className="text-base font-bold">{fa.quotes.total}</dt>
          <dd className="text-base font-bold">{toman(q.total)}</dd>
        </dl>

        {q.notes ? (
          <section>
            <h3 className="mb-1 font-semibold">{fa.quotes.notes}</h3>
            <p className="whitespace-pre-wrap text-sm">{q.notes}</p>
          </section>
        ) : null}
        {q.terms ? (
          <section>
            <h3 className="mb-1 font-semibold">{fa.quotes.terms}</h3>
            <p className="whitespace-pre-wrap text-sm">{q.terms}</p>
          </section>
        ) : null}
      </article>

      <p className="mt-2 text-sm text-[var(--color-text-muted)] print:hidden">
        {fa.quotes.pdfHint}
      </p>

      {q.contract ? (
        <p className="mt-4 text-sm print:hidden">
          {fa.quotes.contract}:{' '}
          <Link href={`/contracts/${q.contract.id}`} className="font-medium underline">
            {q.contract.number}
          </Link>
        </p>
      ) : null}

      {versions.data && versions.data.length > 1 ? (
        <div className="mt-6 print:hidden">
          <Card title={fa.quotes.versions}>
            <DataTable
              head={[fa.quotes.version, fa.quotes.status, fa.quotes.total, fa.quotes.issueDate]}
            >
              {versions.data.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <Link href={`/quotes/${v.id}`} className="font-medium hover:underline">
                      {formatNumber(v.version)}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={QUOTE_TONE[v.status]}>{fa.quotes.statuses[v.status]}</Badge>
                  </Td>
                  <Td className="tabular-nums">{toman(v.total)}</Td>
                  <Td>{formatJalaliDate(v.issueDate)}</Td>
                </Tr>
              ))}
            </DataTable>
          </Card>
        </div>
      ) : null}
    </>
  );
}
