'use client';

import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreateLeadRequestSchema,
  PERMISSIONS,
  type CampaignDto,
  type LeadDto,
  type LeadSourceDto,
  type LeadStatus,
  type Page,
} from '@ishan/contracts';
import { fa, formatJalaliDate } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
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
const STATUS_TONE: Record<LeadStatus, 'neutral' | 'brand' | 'success' | 'danger'> = {
  NEW: 'neutral',
  CONTACTED: 'brand',
  QUALIFIED: 'success',
  DISQUALIFIED: 'danger',
  CONVERTED: 'success',
};

export default function LeadsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState<LeadDto | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['leads', applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: '25' });
      if (applied.q) sp.set('q', applied.q);
      if (applied.status) sp.set('status', applied.status);
      if (pageParam) sp.set('cursor', pageParam);
      return api<Page<LeadDto>>(`/leads?${sp.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const canWrite = can(PERMISSIONS.LEADS_WRITE);

  const setLeadStatus = useMutation({
    mutationFn: ({ id, status: st, version }: { id: string; status: string; version: string }) => {
      let reason: string | undefined;
      if (st === 'DISQUALIFIED') {
        reason = window.prompt(fa.leads.disqualifyReason) ?? undefined;
      }
      return api(`/leads/${id}`, {
        method: 'PATCH',
        version,
        body: { status: st, ...(reason ? { disqualifyReason: reason } : {}) },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    onError: (e) => toast(msg(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/leads/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    onError: (e) => toast(msg(e), 'error'),
  });

  return (
    <>
      <PageHeader
        title={fa.leads.title}
        actions={
          canWrite ? <Button onClick={() => setCreating(true)}>{fa.leads.add}</Button> : undefined
        }
      />
      <Card>
        <form
          role="search"
          className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ q: q.trim(), status });
          }}
        >
          <Input
            aria-label={fa.common.search}
            placeholder={fa.leads.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            aria-label={fa.common.status}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{fa.leads.allStatuses}</option>
            {Object.entries(fa.leads.status).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
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
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.common.name,
              fa.leads.company,
              fa.customers.phone,
              fa.leads.source,
              fa.leads.campaign,
              fa.common.status,
              fa.customers.owner,
              fa.common.createdAt,
              fa.common.actions,
            ]}
          >
            {items.map((l) => (
              <Tr key={l.id}>
                <Td>{l.name}</Td>
                <Td>{l.company ?? '—'}</Td>
                <Td className="text-end [direction:ltr]">{l.phone ?? '—'}</Td>
                <Td>{l.source?.name ?? '—'}</Td>
                <Td>{l.campaign?.name ?? '—'}</Td>
                <Td>
                  {canWrite && l.status !== 'CONVERTED' ? (
                    <Select
                      aria-label={fa.common.status}
                      value={l.status}
                      onChange={(e) =>
                        setLeadStatus.mutate({
                          id: l.id,
                          status: e.target.value,
                          version: l.updatedAt,
                        })
                      }
                    >
                      {(['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'] as const).map((s) => (
                        <option key={s} value={s}>
                          {fa.leads.status[s]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone={STATUS_TONE[l.status]}>{fa.leads.status[l.status]}</Badge>
                  )}
                </Td>
                <Td>{l.owner?.name ?? '—'}</Td>
                <Td>{formatJalaliDate(l.createdAt)}</Td>
                <Td>
                  <div className="flex gap-1">
                    {l.status === 'CONVERTED' && l.convertedCustomerId ? (
                      <Link
                        className="text-sm text-[var(--color-brand)] hover:underline"
                        href={`/customers/${l.convertedCustomerId}`}
                      >
                        {fa.leads.openCustomer}
                      </Link>
                    ) : null}
                    {can(PERMISSIONS.LEADS_CONVERT) &&
                    ['NEW', 'CONTACTED', 'QUALIFIED'].includes(l.status) ? (
                      <Button variant="ghost" onClick={() => setConverting(l)}>
                        {fa.leads.convert}
                      </Button>
                    ) : null}
                    {canWrite && l.status !== 'CONVERTED' ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(fa.leads.deleteConfirm)) remove.mutate(l.id);
                        }}
                      >
                        {fa.common.delete}
                      </Button>
                    ) : null}
                  </div>
                </Td>
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
      {creating ? <CreateLeadDialog onClose={() => setCreating(false)} /> : null}
      {converting ? <ConvertDialog lead={converting} onClose={() => setConverting(null)} /> : null}
    </>
  );
}

function CreateLeadDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    sourceId: '',
    campaignId: '',
    notes: '',
  });
  const { can } = useAuth();
  const sources = useQuery({
    queryKey: ['lead-sources', 'active'],
    queryFn: () => api<LeadSourceDto[]>('/lead-sources?activeOnly=true'),
  });
  const campaigns = useQuery({
    queryKey: ['campaigns', 'options'],
    enabled: can(PERMISSIONS.CAMPAIGNS_READ),
    queryFn: () => api<Page<CampaignDto>>('/campaigns?limit=100'),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const parsed = CreateLeadRequestSchema.safeParse({
        ...f,
        sourceId: f.sourceId || null,
        campaignId: f.campaignId || null,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? fa.common.error);
      return api('/leads', { method: 'POST', body: parsed.data });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['leads'] });
      toast(fa.leads.created);
      onClose();
    },
    onError: (e) => setError(msg(e)),
  });
  return (
    <Modal title={fa.leads.add} onClose={onClose}>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {error ? (
          <div className="sm:col-span-2">
            <ErrorBanner message={error} />
          </div>
        ) : null}
        <Field label={fa.common.name}>
          {(p) => <Input {...p} value={f.name} onChange={set('name')} />}
        </Field>
        <Field label={fa.leads.company}>
          {(p) => <Input {...p} value={f.company} onChange={set('company')} />}
        </Field>
        <Field label={fa.common.email}>
          {(p) => <Input {...p} dir="ltr" type="email" value={f.email} onChange={set('email')} />}
        </Field>
        <Field label={fa.customers.phone}>
          {(p) => (
            <Input {...p} dir="ltr" inputMode="tel" value={f.phone} onChange={set('phone')} />
          )}
        </Field>
        <Field label={fa.leads.source}>
          {(p) => (
            <Select {...p} value={f.sourceId} onChange={set('sourceId')}>
              <option value="">—</option>
              {(sources.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {can(PERMISSIONS.CAMPAIGNS_READ) ? (
          <Field label={fa.leads.campaign}>
            {(p) => (
              <Select {...p} value={f.campaignId} onChange={set('campaignId')}>
                <option value="">—</option>
                {(campaigns.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label={fa.customers.notes}>
          {(p) => <Input {...p} value={f.notes} onChange={set('notes')} />}
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ConvertDialog({ lead, onClose }: { lead: LeadDto; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'PERSON' | 'ORGANIZATION'>(
    lead.company ? 'ORGANIZATION' : 'PERSON',
  );
  const [withDeal, setWithDeal] = useState(false);
  const [title, setTitle] = useState('');
  const [toman, setToman] = useState('');
  const [error, setError] = useState<string | null>(null);
  const convert = useMutation({
    mutationFn: () => {
      const amount = (BigInt(toman.replace(/\D/g, '') || '0') * 10n).toString();
      return api<{ customerId: string }>(`/leads/${lead.id}/convert`, {
        method: 'POST',
        body: { customerKind: kind, ...(withDeal ? { deal: { title, amount } } : {}) },
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['leads'] });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['deals'] });
      toast(fa.leads.converted);
      onClose();
    },
    onError: (e) => setError(msg(e)),
  });
  return (
    <Modal title={`${fa.leads.convertTitle}: ${lead.name}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          convert.mutate();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={fa.leads.customerKind}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="PERSON">{fa.customers.person}</option>
              <option value="ORGANIZATION">{fa.customers.organization}</option>
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withDeal}
            onChange={(e) => setWithDeal(e.target.checked)}
          />
          {fa.leads.withDeal}
        </label>
        {withDeal ? (
          <>
            <Field label={fa.leads.dealTitle}>
              {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
            <Field label={fa.deals.amountToman}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="numeric"
                  value={toman}
                  onChange={(e) => setToman(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button
            type="submit"
            loading={convert.isPending}
            disabled={withDeal && title.trim().length < 2}
          >
            {fa.leads.convert}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
