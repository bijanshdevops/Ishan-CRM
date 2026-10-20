import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type {
  ActivityType,
  CampaignRoiRowDto,
  LeadSourceRowDto,
  DashboardDto,
  DashboardQuery,
  LeadStatus,
  ReportQuery,
  SalesPerformanceDto,
  SalesPerformanceRowDto,
} from '@ishan/contracts';
import { DEFAULT_REPORT_DAYS, PERMISSIONS, roiBasisPoints } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toCsv } from '../customers/csv';

/** Iran observes a fixed UTC+03:30 (no DST), so Tehran days are plain arithmetic. */
const TEHRAN_OFFSET_MS = 210 * 60_000;
const DAY_MS = 86_400_000;
/** Upper bound of won deals loaded to build the daily series. */
const WON_SERIES_CAP = 50_000;

const LEAD_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'];
const ACTIVITY_TYPES: ActivityType[] = ['CALL', 'MEETING', 'TASK', 'NOTE'];

const big = (v: bigint | null | undefined) => v ?? 0n;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Return on each campaign over its whole life: leads attributed to it, how many converted, and
   * the total of the won deals those leads opened, against the budget.
   */
  async campaignRoi(actor: AuthUser): Promise<CampaignRoiRowDto[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { organizationId: actor.organizationId, deletedAt: null },
      select: { id: true, name: true, status: true, budget: true },
      orderBy: { id: 'desc' },
      take: 500,
    });
    if (campaigns.length === 0) return [];
    const leads = await this.prisma.lead.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        campaignId: { in: campaigns.map((c) => c.id) },
      },
      select: { campaignId: true, status: true, convertedDealId: true },
      take: WON_SERIES_CAP,
    });
    const dealIds = leads.flatMap((l) => (l.convertedDealId ? [l.convertedDealId] : []));
    const won = dealIds.length
      ? await this.prisma.deal.findMany({
          where: {
            id: { in: dealIds },
            organizationId: actor.organizationId,
            deletedAt: null,
            stage: { kind: 'WON' },
          },
          select: { id: true, amount: true },
        })
      : [];
    const wonById = new Map(won.map((d) => [d.id, d.amount]));
    return campaigns.map((c) => {
      const mine = leads.filter((l) => l.campaignId === c.id);
      let wonAmount = 0n;
      let wonDeals = 0;
      for (const l of mine) {
        const amount = l.convertedDealId ? wonById.get(l.convertedDealId) : undefined;
        if (amount !== undefined) {
          wonAmount += amount;
          wonDeals += 1;
        }
      }
      return {
        campaignId: c.id,
        name: c.name,
        status: c.status,
        budget: c.budget.toString(),
        leads: mine.length,
        converted: mine.filter((l) => l.status === 'CONVERTED').length,
        wonDeals,
        wonAmount: wonAmount.toString(),
        costPerLead: mine.length > 0 ? (c.budget / BigInt(mine.length)).toString() : null,
        roiBp: roiBasisPoints(wonAmount, c.budget),
      };
    });
  }

  /** Leads created in the range, grouped by source, with their conversion rate. */
  async leadSources(actor: AuthUser, q: ReportQuery): Promise<LeadSourceRowDto[]> {
    const { from, to } = this.range(q);
    const [sources, leads] = await Promise.all([
      this.prisma.leadSource.findMany({
        where: { organizationId: actor.organizationId },
        select: { id: true, name: true },
      }),
      this.prisma.lead.groupBy({
        by: ['sourceId', 'status'],
        where: {
          organizationId: actor.organizationId,
          deletedAt: null,
          createdAt: { gte: from, lt: to },
        },
        _count: { _all: true },
      }),
    ]);
    const names = new Map(sources.map((s) => [s.id, s.name]));
    const rows = new Map<string | null, { leads: number; converted: number }>();
    for (const g of leads) {
      const row = rows.get(g.sourceId) ?? { leads: 0, converted: 0 };
      row.leads += g._count._all;
      if (g.status === 'CONVERTED') row.converted += g._count._all;
      rows.set(g.sourceId, row);
    }
    return [...rows.entries()]
      .map(([sourceId, r]) => ({
        sourceId,
        name: sourceId ? (names.get(sourceId) ?? '—') : '',
        leads: r.leads,
        converted: r.converted,
        conversionBp: r.leads > 0 ? Math.floor((r.converted * 10_000) / r.leads) : 0,
      }))
      .sort((a, b) => b.leads - a.leads);
  }

  private range(q: { from?: string; to?: string }): { from: Date; to: Date } {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - DEFAULT_REPORT_DAYS * DAY_MS);
    return { from, to };
  }

  async dashboard(actor: AuthUser, q: DashboardQuery): Promise<DashboardDto> {
    const has = (p: string) => actor.permissions.includes(p);
    if (q.scope === 'all' && !has(PERMISSIONS.REPORTS_READ)) {
      throw new ForbiddenException('دسترسی به آمار کل سازمان ندارید');
    }
    const { from, to } = this.range(q);
    const mine = q.scope === 'me';
    const [customers, leads, deals, activities] = await Promise.all([
      has(PERMISSIONS.CUSTOMERS_READ) ? this.customerStats(actor, mine, from, to) : null,
      has(PERMISSIONS.LEADS_READ) ? this.leadStats(actor, mine, from, to) : null,
      has(PERMISSIONS.DEALS_READ) ? this.dealStats(actor, mine, from, to) : null,
      has(PERMISSIONS.ACTIVITIES_READ) ? this.activityStats(actor, mine, from, to) : null,
    ]);
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      scope: q.scope,
      customers,
      leads,
      deals,
      activities,
    };
  }

  private async customerStats(actor: AuthUser, mine: boolean, from: Date, to: Date) {
    const base = {
      organizationId: actor.organizationId,
      deletedAt: null,
      ...(mine ? { ownerId: actor.id } : {}),
    };
    const [total, created] = await Promise.all([
      this.prisma.customer.count({ where: base }),
      this.prisma.customer.count({ where: { ...base, createdAt: { gte: from, lt: to } } }),
    ]);
    return { total, created };
  }

  private async leadStats(actor: AuthUser, mine: boolean, from: Date, to: Date) {
    const base = {
      organizationId: actor.organizationId,
      deletedAt: null,
      ...(mine ? { ownerId: actor.id } : {}),
    };
    const [groups, created, converted] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.lead.count({ where: { ...base, createdAt: { gte: from, lt: to } } }),
      this.prisma.lead.count({ where: { ...base, convertedAt: { gte: from, lt: to } } }),
    ]);
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<
      LeadStatus,
      number
    >;
    for (const g of groups) byStatus[g.status as LeadStatus] = g._count._all;
    return {
      open: byStatus.NEW + byStatus.CONTACTED + byStatus.QUALIFIED,
      created,
      converted,
      byStatus,
    };
  }

  private async dealStats(
    actor: AuthUser,
    mine: boolean,
    from: Date,
    to: Date,
  ): Promise<NonNullable<DashboardDto['deals']>> {
    const base = {
      organizationId: actor.organizationId,
      deletedAt: null,
      ...(mine ? { ownerId: actor.id } : {}),
    };
    const [stages, openGroups, closedGroups, wonRows] = await Promise.all([
      this.prisma.pipelineStage.findMany({
        where: { organizationId: actor.organizationId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.deal.groupBy({
        by: ['stageId'],
        where: { ...base, stage: { kind: 'OPEN' } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.deal.groupBy({
        by: ['stageId'],
        where: {
          ...base,
          stage: { kind: { in: ['WON', 'LOST'] } },
          closedAt: { gte: from, lt: to },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.deal.findMany({
        where: {
          ...base,
          stage: { kind: 'WON' },
          closedAt: { gte: from, lt: to },
        },
        select: { closedAt: true, amount: true },
        orderBy: { closedAt: 'asc' },
        take: WON_SERIES_CAP,
      }),
    ]);

    const grouped = new Map<string, { count: number; amount: bigint }>();
    for (const g of [...openGroups, ...closedGroups]) {
      grouped.set(g.stageId, { count: g._count._all, amount: big(g._sum.amount) });
    }
    let openCount = 0;
    let openAmount = 0n;
    let weighted = 0n;
    let wonCount = 0;
    let wonAmount = 0n;
    let lostCount = 0;
    const byStage = stages.map((s) => {
      const g = grouped.get(s.id) ?? { count: 0, amount: 0n };
      if (s.kind === 'OPEN') {
        openCount += g.count;
        openAmount += g.amount;
        weighted += (g.amount * BigInt(s.probability)) / 100n;
      } else if (s.kind === 'WON') {
        wonCount += g.count;
        wonAmount += g.amount;
      } else {
        lostCount += g.count;
      }
      return {
        stageId: s.id,
        name: s.name,
        kind: s.kind,
        position: s.position,
        count: g.count,
        amount: g.amount.toString(),
      };
    });

    const days = new Map<string, { count: number; amount: bigint }>();
    for (const r of wonRows) {
      if (!r.closedAt) continue;
      const key = new Date(r.closedAt.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
      const cur = days.get(key) ?? { count: 0, amount: 0n };
      cur.count += 1;
      cur.amount += r.amount;
      days.set(key, cur);
    }
    const closed = wonCount + lostCount;
    return {
      openCount,
      openAmount: openAmount.toString(),
      weightedAmount: weighted.toString(),
      wonCount,
      wonAmount: wonAmount.toString(),
      lostCount,
      winRate: closed === 0 ? null : Math.round((wonCount / closed) * 1000) / 10,
      byStage,
      wonByDay: [...days.entries()].map(([date, v]) => ({
        date,
        count: v.count,
        amount: v.amount.toString(),
      })),
    };
  }

  private async activityStats(actor: AuthUser, mine: boolean, from: Date, to: Date) {
    const base: Prisma.ActivityWhereInput = {
      organizationId: actor.organizationId,
      deletedAt: null,
      OR: [{ customerId: null }, { customer: { deletedAt: null } }],
      ...(mine ? { assigneeId: actor.id } : {}),
    };
    const [overdue, groups] = await Promise.all([
      this.prisma.activity.count({
        where: { AND: [base, { status: 'PLANNED', dueAt: { lt: new Date() } }] },
      }),
      this.prisma.activity.groupBy({
        by: ['type'],
        where: { AND: [base, { status: 'DONE', completedAt: { gte: from, lt: to } }] },
        _count: { _all: true },
      }),
    ]);
    const byType = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, 0])) as Record<
      ActivityType,
      number
    >;
    for (const g of groups) byType[g.type as ActivityType] = g._count._all;
    return {
      overdue,
      doneInRange: ACTIVITY_TYPES.reduce((n, t) => n + byType[t], 0),
      byType,
    };
  }

  async salesPerformance(actor: AuthUser, q: ReportQuery): Promise<SalesPerformanceDto> {
    const { from, to } = this.range(q);
    const org = actor.organizationId;
    const [stages, dealGroups, activityGroups] = await Promise.all([
      this.prisma.pipelineStage.findMany({
        where: { organizationId: org },
        select: { id: true, kind: true },
      }),
      this.prisma.deal.groupBy({
        by: ['ownerId', 'stageId'],
        where: {
          organizationId: org,
          deletedAt: null,
          OR: [{ stage: { kind: 'OPEN' } }, { closedAt: { gte: from, lt: to } }],
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.activity.groupBy({
        by: ['assigneeId'],
        where: {
          organizationId: org,
          deletedAt: null,
          status: 'DONE',
          completedAt: { gte: from, lt: to },
        },
        _count: { _all: true },
      }),
    ]);
    const kindOf = new Map(stages.map((s) => [s.id, s.kind]));
    const rows = new Map<string | null, SalesPerformanceRowDto & { won: bigint; open: bigint }>();
    const row = (ownerId: string | null) => {
      let r = rows.get(ownerId);
      if (!r) {
        r = {
          ownerId,
          ownerName: '',
          wonCount: 0,
          wonAmount: '0',
          lostCount: 0,
          openCount: 0,
          openAmount: '0',
          activitiesDone: 0,
          won: 0n,
          open: 0n,
        };
        rows.set(ownerId, r);
      }
      return r;
    };
    for (const g of dealGroups) {
      const r = row(g.ownerId);
      const amount = big(g._sum.amount);
      const kind = kindOf.get(g.stageId);
      if (kind === 'WON') {
        r.wonCount += g._count._all;
        r.won += amount;
      } else if (kind === 'LOST') r.lostCount += g._count._all;
      else {
        r.openCount += g._count._all;
        r.open += amount;
      }
    }
    for (const g of activityGroups) row(g.assigneeId).activitiesDone += g._count._all;

    const ids = [...rows.keys()].filter((k): k is string => k !== null);
    const users = await this.prisma.user.findMany({
      where: { organizationId: org, id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const list = [...rows.values()].map(({ won, open, ...r }) => ({
      ...r,
      ownerName: r.ownerId ? (nameOf.get(r.ownerId) ?? '—') : 'بدون مسئول',
      wonAmount: won.toString(),
      openAmount: open.toString(),
      _won: won,
    }));
    list.sort((a, b) =>
      a._won === b._won ? a.ownerName.localeCompare(b.ownerName, 'fa') : a._won > b._won ? -1 : 1,
    );
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      rows: list.map(({ _won, ...r }) => r),
    };
  }

  async salesPerformanceCsv(actor: AuthUser, q: ReportQuery, ip?: string): Promise<string> {
    const report = await this.salesPerformance(actor, q);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'report.exported',
      entityType: 'report',
      entityId: 'sales-performance',
      metadata: { rows: report.rows.length, from: report.range.from, to: report.range.to },
      ip,
    });
    return toCsv(
      [
        'کارشناس',
        'تعداد برد',
        'مبلغ برد (ریال)',
        'تعداد باخت',
        'فرصت‌های باز',
        'مبلغ باز (ریال)',
        'فعالیت‌های انجام‌شده',
      ],
      report.rows.map((r) => [
        r.ownerName,
        String(r.wonCount),
        r.wonAmount,
        String(r.lostCount),
        String(r.openCount),
        r.openAmount,
        String(r.activitiesDone),
      ]),
    );
  }
}
