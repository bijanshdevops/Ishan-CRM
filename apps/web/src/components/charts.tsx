'use client';

import { useState, type ReactNode } from 'react';
import { fa } from '@ishan/i18n';
import { Button, Card, DataTable, Td, Tr } from './ui';

/* ---------- stat tile ---------------------------------------------------- */

export function StatTile({
  label,
  value,
  sub,
  hero,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hero?: boolean;
  tone?: 'danger';
  title?: string;
}) {
  return (
    <section
      aria-label={label}
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
      <h3 className="text-sm text-[var(--color-text-muted)]">{label}</h3>
      <p
        title={title}
        className={`mt-1 font-semibold ${hero ? 'text-5xl leading-tight' : 'text-3xl'} ${
          tone === 'danger'
            ? 'text-[color-mix(in_srgb,var(--color-danger)_65%,var(--color-text))]'
            : ''
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{sub}</p> : null}
    </section>
  );
}

/* ---------- chart card with a table alternative -------------------------- */

export function ChartCard({
  title,
  subtitle,
  table,
  children,
  busy,
}: {
  title: string;
  subtitle?: string;
  table: { head: string[]; rows: ReactNode[][] };
  children: ReactNode;
  busy?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      title={title}
      actions={
        <Button variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? fa.dashboard.showChart : fa.dashboard.showTable}
        </Button>
      }
    >
      {subtitle ? (
        <p className="-mt-2 mb-3 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
      ) : null}
      <div className={`transition-opacity ${busy ? 'opacity-60' : ''}`}>
        {asTable ? (
          <DataTable head={table.head}>
            {table.rows.map((r, i) => (
              <Tr key={i}>
                {r.map((c, j) => (
                  <Td key={j}>{c}</Td>
                ))}
              </Tr>
            ))}
          </DataTable>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/* ---------- horizontal bar list ------------------------------------------ */

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Text shown at the bar tip. */
  display: string;
}

/** One series, one colour; bars grow from the reading start and are capped at 20px. */
export function BarList({ items, label }: { items: BarItem[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul aria-label={label} className="viz-root flex flex-col">
      {items.map((it) => (
        <li
          key={it.key}
          className="grid grid-cols-[minmax(5rem,9rem)_1fr] items-center gap-3 py-1.5"
        >
          <span className="truncate text-sm" title={it.label}>
            {it.label}
          </span>
          <span className="flex items-center gap-2">
            {it.value > 0 ? (
              <span
                aria-hidden="true"
                className="h-5 rounded-e-[4px] bg-[var(--viz-series-1)]"
                style={{ width: `calc(${(it.value / max) * 100}% * 0.8)`, minWidth: 4 }}
              />
            ) : null}
            <span className="text-sm font-medium">{it.display}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- column chart (time series, RTL: oldest on the right) ---------- */

export interface ColumnPoint {
  key: string;
  label: string;
  value: number;
  /** Formatted value for labels and the tooltip. */
  display: string;
  detail?: string;
}

const W = 640;
const H = 240;
const PAD = { top: 22, bottom: 34, left: 8, right: 56 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function ColumnChart({
  points,
  label,
  axisFormat,
}: {
  points: ColumnPoint[];
  label: string;
  axisFormat: (v: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;
  const maxV = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const slot = pw / Math.max(1, n);
  const barW = Math.min(24, slot * 0.62);
  const xAt = (i: number) => PAD.left + pw - (i + 0.5) * slot; // oldest at the right
  const yAt = (v: number) => PAD.top + ph - (v / maxV) * ph;
  const maxIdx = points.reduce((m, p, i) => (p.value > (points[m]?.value ?? -1) ? i : m), 0);
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const ticks = [0, maxV / 2, maxV];
  const lastIdx = n - 1;

  return (
    <div className="viz-root relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={label}
        className="h-auto w-full"
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'}
              strokeWidth={1}
            />
            <text
              x={W - PAD.right + 6}
              y={yAt(t) + 4}
              fontSize={11}
              fill="var(--color-text-muted)"
              textAnchor="start"
            >
              {t === 0 ? '۰' : axisFormat(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = xAt(i) - barW / 2;
          const h = Math.max(p.value > 0 ? 3 : 0, (p.value / maxV) * ph);
          const y = PAD.top + ph - h;
          const showLabel = i === maxIdx && p.value > 0;
          return (
            <g
              key={p.key}
              tabIndex={0}
              role="img"
              aria-label={`${p.label}: ${p.display}${p.detail ? `، ${p.detail}` : ''}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="outline-none focus-visible:[&>rect:first-child]:fill-[color-mix(in_srgb,var(--viz-series-1)_16%,transparent)]"
            >
              <rect
                x={xAt(i) - slot / 2}
                y={PAD.top}
                width={slot}
                height={ph + PAD.bottom}
                fill="transparent"
              />
              {h > 0 ? (
                <path
                  d={roundedTop(x, y, barW, h, 4)}
                  fill="var(--viz-series-1)"
                  opacity={active === null || active === i ? 1 : 0.55}
                />
              ) : null}
              {showLabel ? (
                <text
                  x={xAt(i)}
                  y={y - 6}
                  fontSize={11}
                  fontWeight={600}
                  textAnchor="middle"
                  fill="currentColor"
                >
                  {p.display}
                </text>
              ) : null}
              {i % labelEvery === 0 || i === lastIdx ? (
                <text
                  x={xAt(i)}
                  y={H - 12}
                  fontSize={11}
                  textAnchor="middle"
                  fill="var(--color-text-muted)"
                >
                  {p.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {active !== null && points[active] ? (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm shadow-lg"
          style={{ left: `${(xAt(active) / W) * 100}%` }}
        >
          <p className="font-semibold">{points[active]!.display}</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {points[active]!.label}
            {points[active]!.detail ? ` · ${points[active]!.detail}` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
