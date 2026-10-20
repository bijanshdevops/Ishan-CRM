'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type ContractDto } from '@ishan/contracts';
import { fa, formatJalaliDate, formatJalaliDateTime, formatMoney } from '@ishan/i18n';
import { JalaliDateField } from '@/components/jalali-date-field';
import { Stamp } from '@/components/stamp';
import { useToast } from '@/components/toast';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.CONTRACTS_WRITE);
  const [editing, setEditing] = useState(false);

  const contract = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api<ContractDto>(`/contracts/${id}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['contract'] });
    void qc.invalidateQueries({ queryKey: ['contracts'] });
    void qc.invalidateQueries({ queryKey: ['quote'] });
  };
  const move = useMutation({
    mutationFn: (action: 'activate' | 'complete' | 'terminate') =>
      api<ContractDto>(`/contracts/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      toast(fa.contracts.transitioned);
      refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  if (contract.isLoading) return <Skeleton rows={6} />;
  if (contract.isError || !contract.data)
    return <ErrorBanner message={msg(contract.error)} onRetry={() => void contract.refetch()} />;
  const c = contract.data;
  const open = c.status === 'DRAFT' || c.status === 'ACTIVE';

  return (
    <>
      <PageHeader
        title={`${c.number} · ${c.title}`}
        actions={
          canWrite && open ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
                {fa.common.edit}
              </Button>
              {c.status === 'DRAFT' ? (
                <Button loading={move.isPending} onClick={() => move.mutate('activate')}>
                  {fa.contracts.activate}
                </Button>
              ) : (
                <Button loading={move.isPending} onClick={() => move.mutate('complete')}>
                  {fa.contracts.complete}
                </Button>
              )}
              <Button
                variant="danger"
                loading={move.isPending}
                onClick={() => {
                  if (window.confirm(fa.contracts.terminateConfirm)) move.mutate('terminate');
                }}
              >
                {fa.contracts.terminate}
              </Button>
            </div>
          ) : undefined
        }
      />
      {editing ? (
        <EditContract
          contract={c}
          onDone={() => {
            setEditing(false);
            refresh();
          }}
        />
      ) : (
        <Card>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--color-text-muted)]">{fa.contracts.status}</dt>
              <dd>
                <Stamp status={c.status} scope="contract" />
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-muted)]">{fa.contracts.customer}</dt>
              <dd>
                <Link href={`/customers/${c.customer.id}`} className="hover:underline">
                  {c.customer.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-muted)]">{fa.contracts.amount}</dt>
              <dd className="">{formatMoney(BigInt(c.amount), 'toman')}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-muted)]">{fa.contracts.quote}</dt>
              <dd>
                <Link href={`/quotes/${c.quote.id}`} className="hover:underline">
                  {c.quote.number}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-muted)]">{fa.contracts.startDate}</dt>
              <dd>{formatJalaliDate(c.startDate)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-muted)]">{fa.contracts.endDate}</dt>
              <dd>{c.endDate ? formatJalaliDate(c.endDate) : '—'}</dd>
            </div>
            {c.signedAt ? (
              <div>
                <dt className="text-[var(--color-text-muted)]">{fa.contracts.signedAt}</dt>
                <dd>{formatJalaliDateTime(c.signedAt)}</dd>
              </div>
            ) : null}
          </dl>
          {c.terms ? (
            <section className="mt-5">
              <h2 className="mb-1 font-semibold">{fa.contracts.terms}</h2>
              <p className="whitespace-pre-wrap text-sm">{c.terms}</p>
            </section>
          ) : null}
        </Card>
      )}
    </>
  );
}

function EditContract({ contract, onDone }: { contract: ContractDto; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(contract.title);
  const [startDate, setStartDate] = useState(contract.startDate);
  const [endDate, setEndDate] = useState(contract.endDate ?? '');
  const [terms, setTerms] = useState(contract.terms ?? '');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/contracts/${contract.id}`, {
        method: 'PATCH',
        body: {
          title,
          ...(startDate ? { startDate } : {}),
          endDate: endDate || null,
          terms: terms.trim() || null,
        },
      }),
    onSuccess: () => {
      toast(fa.contracts.updated);
      onDone();
    },
    onError: (e) => setError(msg(e)),
  });
  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          save.mutate();
        }}
      >
        <Field label={fa.contracts.contractTitle}>
          {(p) => (
            <Input {...p} required value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <JalaliDateField
            label={fa.contracts.startDate}
            value={startDate}
            onChange={setStartDate}
            yearsBack={3}
          />
          <JalaliDateField
            label={fa.contracts.endDate}
            value={endDate}
            onChange={setEndDate}
            optional
            yearsBack={1}
            yearsAhead={10}
          />
        </div>
        <Field label={fa.contracts.terms}>
          {(p) => (
            <Textarea {...p} rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} />
          )}
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onDone}>
            {fa.common.cancel}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}
