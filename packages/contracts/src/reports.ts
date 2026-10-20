import { z } from 'zod';
import type { ActivityType } from './activities';
import type { LeadStatus } from './sales';

const Instant = z.iso.datetime({ offset: true, message: 'زمان نامعتبر است' });

/** Longest window dashboards and reports accept. */
export const MAX_REPORT_DAYS = 400;
export const DEFAULT_REPORT_DAYS = 30;

const range = {
  from: Instant.optional(),
  to: Instant.optional(),
};

function checkRange(v: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (!v.from || !v.to) return;
  const span = Date.parse(v.to) - Date.parse(v.from);
  if (!(span > 0)) ctx.addIssue({ code: 'custom', message: 'بازه زمانی نامعتبر است' });
  else if (span > MAX_REPORT_DAYS * 86_400_000) {
    ctx.addIssue({ code: 'custom', message: `بازه گزارش حداکثر ${MAX_REPORT_DAYS} روز است` });
  }
}

export const DashboardQuerySchema = z
  .object({
    ...range,
    /** `me`: only the signed-in user's records. `all` needs `reports.read`. */
    scope: z.enum(['me', 'all']).default('me'),
  })
  .superRefine(checkRange);
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

export const ReportQuerySchema = z.object({ ...range }).superRefine(checkRange);
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export interface DashboardDto {
  range: { from: string; to: string };
  scope: 'me' | 'all';
  /** A section is null when the viewer lacks the permission to read that data. */
  customers: { total: number; created: number } | null;
  leads: {
    open: number;
    created: number;
    converted: number;
    byStatus: Record<LeadStatus, number>;
  } | null;
  deals: {
    openCount: number;
    /** Integer rials as decimal strings (BigInt-safe). */
    openAmount: string;
    weightedAmount: string;
    wonCount: number;
    wonAmount: string;
    lostCount: number;
    /** Percent 0-100 with one decimal; null when nothing closed in the range. */
    winRate: number | null;
    byStage: Array<{
      stageId: string;
      name: string;
      kind: 'OPEN' | 'WON' | 'LOST';
      position: number;
      count: number;
      amount: string;
    }>;
    /** Won deals per Tehran calendar day (Gregorian `YYYY-MM-DD`); the UI buckets into Jalali months. */
    wonByDay: Array<{ date: string; count: number; amount: string }>;
  } | null;
  activities: {
    overdue: number;
    doneInRange: number;
    byType: Record<ActivityType, number>;
  } | null;
}

export interface SalesPerformanceRowDto {
  ownerId: string | null;
  ownerName: string;
  wonCount: number;
  wonAmount: string;
  lostCount: number;
  openCount: number;
  openAmount: string;
  activitiesDone: number;
}

export interface SalesPerformanceDto {
  range: { from: string; to: string };
  rows: SalesPerformanceRowDto[];
}
