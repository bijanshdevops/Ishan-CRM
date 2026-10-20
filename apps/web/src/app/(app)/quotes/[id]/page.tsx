'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type QuoteDto, type QuoteSummaryDto } from '@ishan/contracts';
import { fa, formatJalaliDate, formatMoney, formatNumber } from '@ishan/i18n';
import { QuoteForm } from '@/components/quote-form';
import { Stamp } from '@/components/stamp';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorBanner, PageHeader, Skeleton } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

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
  const [pressed, setPressed] = useState(false);

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
      setPressed(true);
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
        title={`${q.title}${q.version > 1 ? ` · ${fa.quotes.version} ${formatNumber(q.version)}` : ''}`}
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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="print-area flex flex-col gap-6 rounded-[var(--radius-sm)] border border-[var(--color-border)] border-t-[6px] border-t-[var(--color-brand)] bg-[var(--color-surface)] p-6 sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="doc-number" data-testid="doc-number">
                {q.number}
              </p>

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
            <div className="flex flex-col items-end gap-3 text-sm">
              <div className="flex flex-wrap items-center justify-end gap-3 pe-1">
                <Stamp status={q.status} animate={pressed} />
                {q.expired ? <Stamp status="EXPIRED" /> : null}
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

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--color-text)] text-[var(--color-text-muted)]">
                  <th scope="col" className="w-10 px-2 py-2 text-start font-medium">
                    #
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {fa.quotes.description}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">
                    {fa.quotes.quantity}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">
                    {fa.quotes.unitPrice}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">
                    {fa.quotes.lineTotal}
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.items.map((i, idx) => (
                  <tr key={i.id} className="border-b border-[var(--color-border)]/60">
                    <td className="px-2 py-3 text-[var(--color-text-muted)] tabular-nums">
                      {formatNumber(idx + 1)}
                    </td>
                    <td className="px-2 py-3">{i.description}</td>
                    <td className="px-2 py-3 text-end tabular-nums">{formatNumber(i.quantity)}</td>
                    <td className="px-2 py-3 text-end tabular-nums">{toman(i.unitPrice)}</td>
                    <td className="px-2 py-3 text-end font-semibold tabular-nums">
                      {toman(i.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="ms-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm tabular-nums">
            <dt className="text-[var(--color-text-muted)]">{fa.quotes.subtotal}</dt>
            <dd className="text-end">{toman(q.subtotal)}</dd>
            <dt className="text-[var(--color-text-muted)]">{fa.quotes.discount}</dt>
            <dd className="text-end">{toman(q.discount)}</dd>
            <dt className="text-[var(--color-text-muted)]">
              {fa.quotes.tax} ({formatNumber(q.taxRateBp / 100)}٪)
            </dt>
            <dd className="text-end">{toman(q.taxAmount)}</dd>
            <dt className="mt-2 border-t-2 border-[var(--color-text)] pt-2 text-base font-bold">
              {fa.quotes.total}
            </dt>
            <dd
              className="mt-2 border-t-2 border-[var(--color-text)] pt-2 text-end text-2xl font-extrabold"
              data-testid="quote-total"
            >
              {toman(q.total)}
            </dd>
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

        {versions.data && versions.data.length > 1 ? (
          <aside aria-label={fa.quotes.versions} className="print:hidden">
            <h3 className="mb-2 text-sm font-semibold">{fa.quotes.versions}</h3>
            <ol className="flex flex-col gap-2">
              {versions.data.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/quotes/${v.id}`}
                    aria-current={v.id === q.id ? 'page' : undefined}
                    className={`block rounded-[var(--radius-sm)] border px-3 py-2 text-sm hover:bg-[var(--color-surface-2)] ${
                      v.id === q.id
                        ? 'border-[var(--color-brand)] bg-[var(--color-surface)] border-s-4'
                        : 'border-[var(--color-border)]'
                    }`}
                  >
                    <span className="font-semibold">
                      {fa.quotes.version} {formatNumber(v.version)}
                    </span>{' '}
                    · {fa.quotes.statuses[v.status]}
                    <span className="block tabular-nums text-[var(--color-text-muted)]">
                      {toman(v.total)} · {formatJalaliDate(v.issueDate)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>

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
    </>
  );
}
