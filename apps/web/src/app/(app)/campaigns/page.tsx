'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CAMPAIGN_STATUSES,
  PERMISSIONS,
  type CampaignDto,
  type CampaignRoiRowDto,
  type CampaignStatus,
  type LeadSourceDto,
  type LeadSourceRowDto,
  type Page,
} from '@ishan/contracts';
import { fa, formatJalaliDate, formatMoney, formatNumber } from '@ishan/i18n';
import { JalaliDateField } from '@/components/jalali-date-field';
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
  Textarea,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { rialToTomanInput, tomanInputToRial } from '@/lib/money';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
const toman = (rial: string) => formatMoney(BigInt(rial), 'toman');
const percent = (bp: number) => `${bp < 0 ? '−' : ''}${formatNumber(Math.abs(bp) / 100)}٪`;

export const CAMPAIGN_TONE: Record<CampaignStatus, 'neutral' | 'brand' | 'success' | 'danger'> = {
  PLANNED: 'neutral',
  ACTIVE: 'brand',
  COMPLETED: 'success',
  CANCELED: 'danger',
};

export default function CampaignsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  const [editing, setEditing] = useState<CampaignDto | 'new' | null>(null);
  const canWrite = can(PERMISSIONS.CAMPAIGNS_WRITE);
  const canReport = can(PERMISSIONS.REPORTS_READ);

  const list = useInfiniteQuery({
    queryKey: ['campaigns', applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: '25' });
      if (applied.q) sp.set('q', applied.q);
      if (applied.status) sp.set('status', applied.status);
      if (pageParam) sp.set('cursor', pageParam);
      return api<Page<CampaignDto>>(`/campaigns?${sp.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api(`/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(fa.campaigns.deleted);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  return (
    <>
      <PageHeader
        title={fa.campaigns.title}
        actions={
          canWrite ? (
            <Button onClick={() => setEditing('new')}>{fa.campaigns.add}</Button>
          ) : undefined
        }
      />
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ q, status });
        }}
      >
        <Field label={fa.common.search}>
          {(p) => (
            <Input
              {...p}
              value={q}
              placeholder={fa.campaigns.searchPlaceholder}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.campaigns.status}>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{fa.campaigns.allStatuses}</option>
              {CAMPAIGN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {fa.campaigns.statuses[s]}
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
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.campaigns.name,
              fa.campaigns.channel,
              fa.campaigns.status,
              fa.campaigns.startDate,
              fa.campaigns.budget,
              fa.campaigns.leads,
              canWrite ? fa.common.actions : '',
            ]}
          >
            {items.map((c) => (
              <Tr key={c.id}>
                <Td>{c.name}</Td>
                <Td>{c.channel ?? '—'}</Td>
                <Td>
                  <Badge tone={CAMPAIGN_TONE[c.status]}>{fa.campaigns.statuses[c.status]}</Badge>
                </Td>
                <Td>{c.startDate ? formatJalaliDate(c.startDate) : '—'}</Td>
                <Td>{toman(c.budget)}</Td>
                <Td>{formatNumber(c.leadCount)}</Td>
                <Td>
                  {canWrite ? (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setEditing(c)}>
                        {fa.common.edit}
                      </Button>
                      {can(PERMISSIONS.CAMPAIGNS_DELETE) ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm(fa.campaigns.deleteConfirm)) remove.mutate(c.id);
                          }}
                        >
                          {fa.common.delete}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
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

      {canReport ? <RoiCard /> : null}
      <SourcesCard canWrite={canWrite} canReport={canReport} />

      {editing ? (
        <CampaignDialog
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function RoiCard() {
  const roi = useQuery({
    queryKey: ['reports', 'campaigns'],
    queryFn: () => api<CampaignRoiRowDto[]>('/reports/campaigns'),
  });
  return (
    <section className="mt-6" aria-label={fa.campaigns.roiTitle}>
      <Card title={fa.campaigns.roiTitle}>
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">{fa.campaigns.roiHint}</p>
        {roi.isLoading ? (
          <Skeleton rows={3} />
        ) : roi.isError ? (
          <ErrorBanner message={msg(roi.error)} onRetry={() => void roi.refetch()} />
        ) : (roi.data ?? []).length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.campaigns.name,
              fa.campaigns.budget,
              fa.campaigns.leads,
              fa.campaigns.converted,
              fa.campaigns.wonDeals,
              fa.campaigns.wonAmount,
              fa.campaigns.costPerLead,
              fa.campaigns.roi,
            ]}
          >
            {(roi.data ?? []).map((r) => (
              <Tr key={r.campaignId}>
                <Td>{r.name}</Td>
                <Td>{toman(r.budget)}</Td>
                <Td>{formatNumber(r.leads)}</Td>
                <Td>{formatNumber(r.converted)}</Td>
                <Td>{formatNumber(r.wonDeals)}</Td>
                <Td>{toman(r.wonAmount)}</Td>
                <Td>{r.costPerLead === null ? '—' : toman(r.costPerLead)}</Td>
                <Td>
                  {r.roiBp === null ? (
                    <span className="text-[var(--color-text-muted)]">
                      {fa.campaigns.roiNoBudget}
                    </span>
                  ) : (
                    <span
                      className="font-semibold"
                      style={{
                        color: r.roiBp >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                      }}
                    >
                      {percent(r.roiBp)}
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </Card>
    </section>
  );
}

function SourcesCard({ canWrite, canReport }: { canWrite: boolean; canReport: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const sources = useQuery({
    queryKey: ['lead-sources', 'all'],
    queryFn: () => api<LeadSourceDto[]>('/lead-sources'),
  });
  const rows = useQuery({
    queryKey: ['reports', 'lead-sources'],
    enabled: canReport,
    queryFn: () => api<LeadSourceRowDto[]>('/reports/lead-sources'),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['lead-sources'] });
    void qc.invalidateQueries({ queryKey: ['reports', 'lead-sources'] });
  };
  const add = useMutation({
    mutationFn: () => api('/lead-sources', { method: 'POST', body: { name } }),
    onSuccess: () => {
      toast(fa.campaigns.sourceCreated);
      setName('');
      setError('');
      refresh();
    },
    onError: (e) => setError(msg(e)),
  });
  const toggle = useMutation({
    mutationFn: (s: LeadSourceDto) =>
      api(`/lead-sources/${s.id}`, { method: 'PATCH', body: { active: !s.active } }),
    onSuccess: () => {
      toast(fa.campaigns.sourceUpdated);
      refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const stat = new Map((rows.data ?? []).map((r) => [r.sourceId, r]));

  return (
    <section className="mt-6" aria-label={fa.campaigns.sourcesTitle}>
      <Card title={fa.campaigns.sourcesTitle}>
        {canReport ? (
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">{fa.campaigns.sourcesHint}</p>
        ) : null}
        {canWrite ? (
          <form
            className="mb-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              add.mutate();
            }}
          >
            <Field label={fa.campaigns.sourceName} error={error || undefined}>
              {(p) => (
                <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Button type="submit" loading={add.isPending}>
              {fa.campaigns.addSource}
            </Button>
          </form>
        ) : null}
        {sources.isLoading ? (
          <Skeleton rows={3} />
        ) : sources.isError ? (
          <ErrorBanner message={msg(sources.error)} onRetry={() => void sources.refetch()} />
        ) : (
          <DataTable
            head={[
              fa.campaigns.sourceName,
              ...(canReport
                ? [fa.campaigns.leads, fa.campaigns.converted, fa.campaigns.conversion]
                : []),
              canWrite ? fa.common.actions : '',
            ]}
          >
            {(sources.data ?? []).map((s) => {
              const r = stat.get(s.id);
              return (
                <Tr key={s.id}>
                  <Td>
                    {s.name} {s.active ? null : <Badge>{fa.campaigns.inactive}</Badge>}
                  </Td>
                  {canReport ? (
                    <>
                      <Td>{formatNumber(r?.leads ?? 0)}</Td>
                      <Td>{formatNumber(r?.converted ?? 0)}</Td>
                      <Td>{percent(r?.conversionBp ?? 0)}</Td>
                    </>
                  ) : null}
                  <Td>
                    {canWrite ? (
                      <Button variant="ghost" onClick={() => toggle.mutate(s)}>
                        {s.active ? fa.campaigns.deactivate : fa.campaigns.activate}
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
            {canReport && stat.has(null) ? (
              <Tr>
                <Td>{fa.campaigns.noSource}</Td>
                <Td>{formatNumber(stat.get(null)!.leads)}</Td>
                <Td>{formatNumber(stat.get(null)!.converted)}</Td>
                <Td>{percent(stat.get(null)!.conversionBp)}</Td>
                <Td />
              </Tr>
            ) : null}
          </DataTable>
        )}
      </Card>
    </section>
  );
}

function CampaignDialog({
  campaign,
  onClose,
}: {
  campaign: CampaignDto | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(campaign?.name ?? '');
  const [channel, setChannel] = useState(campaign?.channel ?? '');
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? 'PLANNED');
  const [startDate, setStartDate] = useState(campaign?.startDate ?? '');
  const [endDate, setEndDate] = useState(campaign?.endDate ?? '');
  const [budget, setBudget] = useState(campaign ? rialToTomanInput(campaign.budget) : '');
  const [notes, setNotes] = useState(campaign?.notes ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const rial = budget.trim() === '' ? 0n : tomanInputToRial(budget);
      if (rial === null) throw new Error('بودجه نامعتبر است');
      const body = campaign
        ? {
            name,
            channel: channel.trim() || null,
            status,
            startDate: startDate || null,
            endDate: endDate || null,
            budget: rial.toString(),
            notes: notes.trim() || null,
          }
        : {
            name,
            channel: channel.trim() || undefined,
            status,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            budget: rial.toString(),
            notes: notes.trim() || undefined,
          };
      return campaign
        ? api(`/campaigns/${campaign.id}`, { method: 'PATCH', body })
        : api('/campaigns', { method: 'POST', body });
    },
    onSuccess: () => {
      toast(campaign ? fa.campaigns.updated : fa.campaigns.created);
      onClose();
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['reports', 'campaigns'] });
    },
    onError: (e) => setError(msg(e)),
  });

  return (
    <Modal title={campaign ? fa.campaigns.edit : fa.campaigns.add} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          save.mutate();
        }}
      >
        <Field label={fa.campaigns.name}>
          {(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={fa.campaigns.channel}>
            {(p) => <Input {...p} value={channel} onChange={(e) => setChannel(e.target.value)} />}
          </Field>
          <Field label={fa.campaigns.status}>
            {(p) => (
              <Select
                {...p}
                value={status}
                onChange={(e) => setStatus(e.target.value as CampaignStatus)}
              >
                {CAMPAIGN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {fa.campaigns.statuses[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <JalaliDateField
            label={fa.campaigns.startDate}
            value={startDate}
            onChange={setStartDate}
            optional
            yearsBack={2}
          />
          <JalaliDateField
            label={fa.campaigns.endDate}
            value={endDate}
            onChange={setEndDate}
            optional
            yearsBack={2}
          />
        </div>
        <Field label={fa.campaigns.budget}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.campaigns.notes}>
          {(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex justify-end gap-2">
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
