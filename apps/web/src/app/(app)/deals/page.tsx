'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PERMISSIONS,
  type DealDto,
  type FunnelDto,
  type Page,
  type StageDto,
} from '@ishan/contracts';
import { fa, formatJalaliDate, formatMoney, formatNumber } from '@ishan/i18n';
import { CustomerPicker } from '@/components/customer-picker';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
const toRial = (toman: string) => (BigInt(toman.replace(/\D/g, '') || '0') * 10n).toString();
const toToman = (rial: string) => (BigInt(rial) / 10n).toString();

export default function DealsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(PERMISSIONS.DEALS_WRITE);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DealDto | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ deal: DealDto; stage: StageDto } | null>(null);

  const stages = useQuery({
    queryKey: ['stages'],
    queryFn: () => api<StageDto[]>('/pipeline/stages'),
  });
  const deals = useQuery({
    queryKey: ['deals'],
    queryFn: () => api<Page<DealDto>>('/deals?limit=200'),
  });
  const funnel = useQuery({ queryKey: ['funnel'], queryFn: () => api<FunnelDto>('/deals/funnel') });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['deals'] });
    await qc.invalidateQueries({ queryKey: ['funnel'] });
  };
  const move = useMutation({
    mutationFn: ({
      id,
      stageId,
      lostReason,
    }: {
      id: string;
      stageId: string;
      lostReason?: string;
    }) =>
      api(`/deals/${id}/move`, {
        method: 'POST',
        body: { stageId, ...(lostReason ? { lostReason } : {}) },
      }),
    onSuccess: async () => {
      toast(fa.deals.moved);
      await refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  const requestMove = (deal: DealDto, stage: StageDto) => {
    if (deal.stage.id === stage.id) return;
    if (stage.kind === 'LOST') setPendingLost({ deal, stage });
    else move.mutate({ id: deal.id, stageId: stage.id });
  };

  const items = deals.data?.items ?? [];
  const t = funnel.data?.totals;

  return (
    <>
      <PageHeader
        title={fa.deals.title}
        actions={
          <div className="flex gap-2">
            {can(PERMISSIONS.PIPELINE_MANAGE) ? (
              <Button variant="secondary" onClick={() => setStagesOpen(true)}>
                {fa.deals.managePipeline}
              </Button>
            ) : null}
            {canWrite ? <Button onClick={() => setCreating(true)}>{fa.deals.add}</Button> : null}
          </div>
        }
      />
      {t ? (
        <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [
              fa.deals.funnelOpen,
              `${formatNumber(t.openCount)} · ${formatMoney(BigInt(t.openAmount), 'toman')}`,
            ],
            [fa.deals.funnelWeighted, formatMoney(BigInt(t.weightedAmount), 'toman')],
            [
              fa.deals.funnelWon,
              `${formatNumber(t.wonCount)} · ${formatMoney(BigInt(t.wonAmount), 'toman')}`,
            ],
            [fa.deals.funnelLost, formatNumber(t.lostCount)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
              <dd className="mt-1 text-base font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {stages.isLoading || deals.isLoading ? (
        <Skeleton />
      ) : stages.isError || deals.isError ? (
        <ErrorBanner message={fa.common.error} onRetry={() => void deals.refetch()} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" role="list">
          {stages.data?.map((s) => {
            const col = items.filter((d) => d.stage.id === s.id);
            const sum = col.reduce((a, d) => a + BigInt(d.amount), 0n);
            return (
              <section
                key={s.id}
                role="listitem"
                aria-label={s.name}
                className="flex w-72 shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                onDragOver={(e) => canWrite && e.preventDefault()}
                onDrop={() => {
                  const d = items.find((x) => x.id === dragId);
                  setDragId(null);
                  if (d && canWrite) requestMove(d, s);
                }}
              >
                <header className="border-b border-[var(--color-border)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{s.name}</h2>
                    <Badge
                      tone={s.kind === 'WON' ? 'success' : s.kind === 'LOST' ? 'danger' : 'neutral'}
                    >
                      {formatNumber(col.length)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {formatMoney(sum, 'toman')}
                  </p>
                </header>
                <ul className="flex min-h-24 flex-col gap-2 p-2">
                  {col.length === 0 ? (
                    <li className="p-2 text-center text-xs text-[var(--color-text-muted)]">
                      {fa.deals.noDeals}
                    </li>
                  ) : null}
                  {col.map((d) => (
                    <li
                      key={d.id}
                      draggable={canWrite}
                      onDragStart={() => setDragId(d.id)}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
                    >
                      <button
                        type="button"
                        className="w-full text-start font-medium hover:underline focus-visible:outline-2"
                        onClick={() => setEditing(d)}
                      >
                        {d.title}
                      </button>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        <Link href={`/customers/${d.customer.id}`} className="hover:underline">
                          {d.customer.name}
                        </Link>
                      </p>
                      <p className="mt-1 font-medium">{formatMoney(BigInt(d.amount), 'toman')}</p>
                      {d.expectedCloseDate ? (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {formatJalaliDate(d.expectedCloseDate)}
                        </p>
                      ) : null}
                      {canWrite ? (
                        <Select
                          aria-label={`${fa.deals.moveTo}: ${d.title}`}
                          className="mt-2"
                          value={d.stage.id}
                          onChange={(e) => {
                            const st = stages.data?.find((x) => x.id === e.target.value);
                            if (st) requestMove(d, st);
                          }}
                        >
                          {stages.data?.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {creating ? (
        <DealDialog
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      ) : null}
      {editing ? (
        <DealDialog
          deal={editing}
          canDelete={can(PERMISSIONS.DEALS_DELETE)}
          readOnly={!canWrite}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
      {pendingLost ? (
        <LostDialog
          deal={pendingLost.deal}
          onClose={() => setPendingLost(null)}
          onConfirm={(reason) => {
            move.mutate({
              id: pendingLost.deal.id,
              stageId: pendingLost.stage.id,
              lostReason: reason,
            });
            setPendingLost(null);
          }}
        />
      ) : null}
      {stagesOpen ? <StagesDialog onClose={() => setStagesOpen(false)} /> : null}
    </>
  );
}

function LostDialog({
  deal,
  onClose,
  onConfirm,
}: {
  deal: DealDto;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={deal.title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason.trim());
        }}
      >
        <Field label={fa.deals.lostReason}>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button type="submit" variant="danger">
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DealDialog({
  deal,
  canDelete,
  readOnly,
  onClose,
  onSaved,
}: {
  deal?: DealDto;
  canDelete?: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(deal?.title ?? '');
  const [customerId, setCustomerId] = useState(deal?.customer.id ?? '');
  const [toman, setToman] = useState(deal ? toToman(deal.amount) : '');
  const [date, setDate] = useState(deal?.expectedCloseDate ?? '');
  const [notes, setNotes] = useState(deal?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (title.trim().length < 2) throw new Error('عنوان باید حداقل ۲ نویسه باشد');
      if (!deal && !customerId) throw new Error('مشتری را انتخاب کنید');
      const body = {
        title: title.trim(),
        amount: toRial(toman),
        ...(date ? { expectedCloseDate: date } : deal ? { expectedCloseDate: null } : {}),
        notes: notes.trim(),
      };
      return deal
        ? api(`/deals/${deal.id}`, { method: 'PATCH', body, version: deal.updatedAt })
        : api('/deals', { method: 'POST', body: { ...body, customerId } });
    },
    onSuccess: async () => {
      toast(deal ? fa.deals.updated : fa.deals.created);
      await onSaved();
    },
    onError: (e) => setError(msg(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/deals/${deal!.id}`, { method: 'DELETE' }),
    onSuccess: onSaved,
    onError: (e) => setError(msg(e)),
  });
  return (
    <Modal title={deal ? fa.deals.edit : fa.deals.add} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!readOnly) save.mutate();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        {deal ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            {fa.deals.customer}: {deal.customer.name} · {fa.deals.stage}: {deal.stage.name}
            {deal.lostReason ? ` · ${fa.deals.lostReason}: ${deal.lostReason}` : ''}
          </p>
        ) : (
          <CustomerPicker value={customerId} onChange={setCustomerId} />
        )}
        <Field label={fa.deals.dealTitle}>
          {(p) => (
            <Input
              {...p}
              readOnly={readOnly}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.deals.amountToman}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="numeric"
              readOnly={readOnly}
              value={toman}
              onChange={(e) => setToman(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.deals.expectedClose}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              type="date"
              readOnly={readOnly}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.deals.notes}>
          {(p) => (
            <Input
              {...p}
              readOnly={readOnly}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-between gap-2">
          {deal && canDelete ? (
            <Button
              type="button"
              variant="danger"
              loading={del.isPending}
              onClick={() => {
                if (window.confirm(fa.deals.deleteConfirm)) del.mutate();
              }}
            >
              {fa.common.delete}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {fa.common.close}
            </Button>
            {!readOnly ? (
              <Button type="submit" loading={save.isPending}>
                {fa.common.save}
              </Button>
            ) : null}
          </div>
        </div>
      </form>
    </Modal>
  );
}

function StagesDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const stages = useQuery({
    queryKey: ['stages'],
    queryFn: () => api<StageDto[]>('/pipeline/stages'),
  });
  const [name, setName] = useState('');
  const [prob, setProb] = useState('50');
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['stages'] });
    await qc.invalidateQueries({ queryKey: ['funnel'] });
    await qc.invalidateQueries({ queryKey: ['deals'] });
  };
  const fail = (e: unknown) => setError(msg(e));
  const create = useMutation({
    mutationFn: () =>
      api('/pipeline/stages', {
        method: 'POST',
        body: { name: name.trim(), probability: Number(prob) || 0 },
      }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/pipeline/stages/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: fail,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api('/pipeline/stages/order', { method: 'PUT', body: { stageIds: ids } }),
    onSuccess: async () => {
      toast(fa.common.save);
      await refresh();
    },
    onError: fail,
  });
  const shift = (i: number, d: -1 | 1) => {
    const ids = stages.data?.map((s) => s.id) ?? [];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  return (
    <Modal title={fa.deals.managePipeline} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {error ? <ErrorBanner message={error} /> : null}
        <ol className="flex flex-col gap-2">
          {stages.data?.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] p-2 text-sm"
            >
              <span>
                {s.name} <Badge>{fa.deals.kind[s.kind]}</Badge> · {formatNumber(s.probability)}٪
              </span>
              <span className="flex gap-1">
                <Button
                  variant="ghost"
                  aria-label={fa.deals.up}
                  disabled={i === 0}
                  onClick={() => shift(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  aria-label={fa.deals.down}
                  disabled={i === (stages.data?.length ?? 0) - 1}
                  onClick={() => shift(i, 1)}
                >
                  ↓
                </Button>
                <Button variant="ghost" onClick={() => remove.mutate(s.id)}>
                  {fa.common.delete}
                </Button>
              </span>
            </li>
          ))}
        </ol>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (name.trim()) create.mutate();
          }}
        >
          <div className="grow">
            <Field label={fa.deals.stageName}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </div>
          <div className="w-28">
            <Field label={fa.deals.probability}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="numeric"
                  value={prob}
                  onChange={(e) => setProb(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" loading={create.isPending}>
            {fa.common.create}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
