'use client';

import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  PERMISSIONS,
  type DashboardDto,
  type LeadStatus,
  type SalesPerformanceDto,
} from '@ishan/contracts';
import {
  JALALI_MONTHS,
  fa,
  formatCompactToman,
  formatMoney,
  formatNumber,
  gregorianToJalali,
} from '@ishan/i18n';
import { BarList, ChartCard, ColumnChart, StatTile, type ColumnPoint } from '@/components/charts';
import { useToast } from '@/components/toast';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Select,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api, apiBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const DAY = 86_400_000;
const TEHRAN = 210 * 60_000;
type Preset = keyof typeof fa.dashboard.ranges;
const PRESETS = Object.keys(fa.dashboard.ranges) as Preset[];
const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
const rial = (v: string) => BigInt(v);
const toman = (v: string) => Number(rial(v) / 10n);

function rangeOf(preset: Preset) {
  const to = new Date();
  return {
    from: new Date(to.getTime() - Number(preset) * DAY).toISOString(),
    to: to.toISOString(),
  };
}

const tehranDate = (t: number) => new Date(t + TEHRAN).toISOString().slice(0, 10);

/** Daily columns for short ranges, Jalali-month columns otherwise (newest last). */
function buildTrend(d: NonNullable<DashboardDto['deals']>, range: DashboardDto['range']) {
  const start = Date.parse(range.from);
  const end = Date.parse(range.to);
  const days = Math.max(1, Math.ceil((end - start) / DAY));
  const daily = days <= 45;
  const byDay = new Map(d.wonByDay.map((r) => [r.date, r]));
  const buckets = new Map<string, { label: string; amount: bigint; count: number }>();
  for (let t = start; t <= end + DAY - 1; t += DAY) {
    const date = tehranDate(t);
    const [gy, gm, gd] = date.split('-').map(Number) as [number, number, number];
    const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
    const key = daily ? date : `${jy}-${jm}`;
    const label = daily
      ? `${formatNumber(jd)} ${JALALI_MONTHS[jm - 1]}`
      : `${JALALI_MONTHS[jm - 1]} ${new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(jy)}`;
    const cur = buckets.get(key) ?? { label, amount: 0n, count: 0 };
    const hit = byDay.get(date);
    if (hit) {
      cur.amount += rial(hit.amount);
      cur.count += hit.count;
    }
    buckets.set(key, cur);
  }
  const points: ColumnPoint[] = [...buckets.entries()].map(([key, b]) => ({
    key,
    label: b.label,
    value: Number(b.amount / 10n),
    display: formatCompactToman(b.amount),
    detail: `${formatNumber(b.count)} ${fa.dashboard.wonCount}`,
  }));
  return { points, daily };
}

const LEAD_ORDER: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'];

export default function DashboardPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>('30');
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const canAll = can(PERMISSIONS.REPORTS_READ);
  const effectiveScope = canAll ? scope : 'me';

  const dash = useQuery({
    queryKey: ['dashboard', effectiveScope, preset],
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    queryFn: () => {
      const r = rangeOf(preset);
      return api<DashboardDto>(
        `/dashboard?scope=${effectiveScope}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,
      );
    },
  });
  const perf = useQuery({
    queryKey: ['report', 'sales-performance', preset],
    enabled: canAll,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const r = rangeOf(preset);
      return api<SalesPerformanceDto>(
        `/reports/sales-performance?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,
      );
    },
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const r = rangeOf(preset);
      const blob = await apiBlob(
        `/reports/sales-performance.csv?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sales-performance.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast(fa.dashboard.exported),
    onError: (e) => toast(msg(e), 'error'),
  });

  const d = dash.data;
  const deals = d?.deals ?? null;
  const trend = useMemo(() => (d && deals ? buildTrend(deals, d.range) : null), [d, deals]);
  if (!user) return null;

  return (
    <>
      <PageHeader title={`${fa.dashboard.title} · ${user.name}`} />
      <div
        className="mb-4 flex flex-wrap items-end gap-3"
        role="group"
        aria-label={fa.dashboard.title}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{fa.dashboard.rangeLabel}</span>
          <Select
            aria-label={fa.dashboard.rangeLabel}
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {fa.dashboard.ranges[p]}
              </option>
            ))}
          </Select>
        </label>
        {canAll ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{fa.dashboard.scopeLabel}</span>
            <Select
              aria-label={fa.dashboard.scopeLabel}
              value={scope}
              onChange={(e) => setScope(e.target.value as 'me' | 'all')}
            >
              <option value="me">{fa.dashboard.scope.me}</option>
              <option value="all">{fa.dashboard.scope.all}</option>
            </Select>
          </label>
        ) : null}
        {dash.isFetching && d ? (
          <span role="status" className="pb-2 text-sm text-[var(--color-text-muted)]">
            {fa.dashboard.refreshing}
          </span>
        ) : null}
      </div>

      {dash.isLoading ? (
        <Skeleton rows={6} />
      ) : dash.isError || !d ? (
        <ErrorBanner message={msg(dash.error)} onRetry={() => void dash.refetch()} />
      ) : (
        <div
          className={`flex flex-col gap-4 transition-opacity ${dash.isFetching ? 'opacity-70' : ''}`}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {deals ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <StatTile
                  hero
                  label={fa.dashboard.wonHero}
                  title={formatMoney(rial(deals.wonAmount), 'toman')}
                  value={
                    <>
                      {formatCompactToman(rial(deals.wonAmount))}{' '}
                      <span className="text-xl font-normal text-[var(--color-text-muted)]">
                        {fa.dashboard.tomanUnit}
                      </span>
                    </>
                  }
                  sub={`${formatNumber(deals.wonCount)} ${fa.dashboard.wonCount} · ${fa.dashboard.winRate}: ${
                    deals.winRate === null
                      ? fa.dashboard.winRateNone
                      : `${formatNumber(deals.winRate)}٪`
                  }`}
                />
              </div>
            ) : null}
            {deals ? (
              <>
                <StatTile
                  label={fa.dashboard.openPipeline}
                  title={formatMoney(rial(deals.openAmount), 'toman')}
                  value={formatCompactToman(rial(deals.openAmount))}
                  sub={`${formatNumber(deals.openCount)} ${fa.dashboard.openDeals} · ${fa.dashboard.tomanUnit}`}
                />
                <StatTile
                  label={fa.dashboard.weighted}
                  title={formatMoney(rial(deals.weightedAmount), 'toman')}
                  value={formatCompactToman(rial(deals.weightedAmount))}
                  sub={fa.dashboard.tomanUnit}
                />
              </>
            ) : null}
            {d.leads ? (
              <StatTile
                label={fa.dashboard.openLeads}
                value={formatNumber(d.leads.open)}
                sub={`${formatNumber(d.leads.created)} ${fa.dashboard.newInRange}`}
              />
            ) : null}
            {d.customers ? (
              <StatTile
                label={fa.dashboard.customers}
                value={formatNumber(d.customers.total)}
                sub={`${formatNumber(d.customers.created)} ${fa.dashboard.newInRange}`}
              />
            ) : null}
            {d.activities ? (
              <Link
                href="/activities"
                className="rounded-[var(--radius-lg)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
              >
                <StatTile
                  label={fa.dashboard.overdue}
                  tone={d.activities.overdue > 0 ? 'danger' : undefined}
                  value={formatNumber(d.activities.overdue)}
                  sub={
                    d.activities.overdue > 0
                      ? `⚠ ${fa.activities.tabs.overdue}`
                      : fa.dashboard.overdueNone
                  }
                />
              </Link>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {deals ? (
              <ChartCard
                title={fa.dashboard.funnel}
                subtitle={fa.dashboard.funnelHint}
                busy={dash.isFetching}
                table={{
                  head: [fa.deals.stage, fa.dashboard.chartCount, fa.dashboard.chartAmount],
                  rows: deals.byStage
                    .filter((s) => s.kind === 'OPEN')
                    .map((s) => [
                      s.name,
                      formatNumber(s.count),
                      formatMoney(rial(s.amount), 'toman'),
                    ]),
                }}
              >
                <BarList
                  label={fa.dashboard.funnel}
                  items={deals.byStage
                    .filter((s) => s.kind === 'OPEN')
                    .map((s) => ({
                      key: s.stageId,
                      label: s.name,
                      value: s.count,
                      display: `${formatNumber(s.count)} · ${formatCompactToman(rial(s.amount))}`,
                    }))}
                />
              </ChartCard>
            ) : null}
            {deals && trend ? (
              <ChartCard
                title={fa.dashboard.trend}
                subtitle={trend.daily ? fa.dashboard.trendDaily : fa.dashboard.trendMonthly}
                busy={dash.isFetching}
                table={{
                  head: [
                    fa.dashboard.chartPeriod,
                    fa.dashboard.chartAmount,
                    fa.dashboard.chartCount,
                  ],
                  rows: trend.points.map((p) => [
                    p.label,
                    formatMoney(BigInt(Math.round(p.value)) * 10n, 'toman'),
                    p.detail ?? '',
                  ]),
                }}
              >
                {deals.wonCount === 0 ? (
                  <EmptyState>{fa.dashboard.noData}</EmptyState>
                ) : (
                  <ColumnChart
                    label={fa.dashboard.trend}
                    points={trend.points}
                    axisFormat={(v) => formatCompactToman(BigInt(Math.round(v)) * 10n)}
                  />
                )}
              </ChartCard>
            ) : null}
            {d.activities ? (
              <ChartCard
                title={fa.dashboard.activities}
                busy={dash.isFetching}
                table={{
                  head: [fa.activities.type, fa.dashboard.chartCount],
                  rows: (['CALL', 'MEETING', 'TASK', 'NOTE'] as const).map((t) => [
                    fa.activities.types[t],
                    formatNumber(d.activities!.byType[t]),
                  ]),
                }}
              >
                <BarList
                  label={fa.dashboard.activities}
                  items={(['CALL', 'MEETING', 'TASK', 'NOTE'] as const).map((t) => ({
                    key: t,
                    label: fa.activities.types[t],
                    value: d.activities!.byType[t],
                    display: formatNumber(d.activities!.byType[t]),
                  }))}
                />
              </ChartCard>
            ) : null}
            {d.leads ? (
              <ChartCard
                title={fa.dashboard.leadsByStatus}
                busy={dash.isFetching}
                table={{
                  head: [fa.common.status, fa.dashboard.chartCount],
                  rows: LEAD_ORDER.map((s) => [
                    fa.leads.status[s],
                    formatNumber(d.leads!.byStatus[s]),
                  ]),
                }}
              >
                <BarList
                  label={fa.dashboard.leadsByStatus}
                  items={LEAD_ORDER.map((s) => ({
                    key: s,
                    label: fa.leads.status[s],
                    value: d.leads!.byStatus[s],
                    display: formatNumber(d.leads!.byStatus[s]),
                  }))}
                />
              </ChartCard>
            ) : null}
          </div>

          {canAll ? (
            <Card
              title={fa.dashboard.performance}
              actions={
                can(PERMISSIONS.REPORTS_EXPORT) ? (
                  <Button
                    variant="secondary"
                    loading={exportCsv.isPending}
                    onClick={() => exportCsv.mutate()}
                  >
                    {fa.dashboard.exportCsv}
                  </Button>
                ) : undefined
              }
            >
              {perf.isLoading ? (
                <Skeleton rows={3} />
              ) : perf.isError ? (
                <ErrorBanner message={msg(perf.error)} onRetry={() => void perf.refetch()} />
              ) : perf.data && perf.data.rows.length > 0 ? (
                <DataTable
                  head={[
                    fa.dashboard.owner,
                    fa.dashboard.won,
                    fa.dashboard.wonAmount,
                    fa.dashboard.lost,
                    fa.dashboard.open,
                    fa.dashboard.openAmount,
                    fa.dashboard.activitiesDone,
                  ]}
                >
                  {perf.data.rows.map((r) => (
                    <Tr key={r.ownerId ?? 'none'}>
                      <Td>{r.ownerName}</Td>
                      <Td>{formatNumber(r.wonCount)}</Td>
                      <Td>{formatMoney(rial(r.wonAmount), 'toman')}</Td>
                      <Td>{formatNumber(r.lostCount)}</Td>
                      <Td>{formatNumber(r.openCount)}</Td>
                      <Td>{formatMoney(rial(r.openAmount), 'toman')}</Td>
                      <Td>{formatNumber(r.activitiesDone)}</Td>
                    </Tr>
                  ))}
                </DataTable>
              ) : (
                <EmptyState>{fa.dashboard.noData}</EmptyState>
              )}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
