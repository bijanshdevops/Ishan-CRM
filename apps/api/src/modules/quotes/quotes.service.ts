import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateQuoteRequest,
  Page,
  QuoteDto,
  QuoteItemInput,
  QuoteListQuery,
  QuoteStatus,
  QuoteSummaryDto,
  UpdateQuoteRequest,
} from '@ishan/contracts';
import {
  QUOTE_TRANSITIONS,
  calculateQuoteTotals,
  normalizeText,
  parseRial,
} from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { dateOnly, quoteInclude, quoteNumber, tehranToday, toQuoteDto } from './mappers';

type Tx = Prisma.TransactionClient;

/** Next value of a per-organization sequence; atomic under concurrency (row lock on upsert). */
export async function nextSequence(tx: Tx, organizationId: string, kind: 'quote' | 'contract') {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO document_counters (organization_id, kind, value)
    VALUES (${organizationId}::uuid, ${kind}, 1)
    ON CONFLICT (organization_id, kind)
    DO UPDATE SET value = document_counters.value + 1
    RETURNING value`;
  return rows[0]!.value;
}

const lines = (items: QuoteItemInput[]) =>
  items.map((i) => ({ quantity: i.quantity, unitPrice: parseRial(i.unitPrice) }));

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
  ) {}

  private async latestVersion(organizationId: string, seq: number) {
    const agg = await this.prisma.quote.aggregate({
      where: { organizationId, seq, deletedAt: null },
      _max: { version: true },
    });
    return agg._max.version ?? 1;
  }

  async list(actor: AuthUser, q: QuoteListQuery): Promise<Page<QuoteSummaryDto>> {
    const term = q.q ? normalizeText(q.q) : '';
    const rows = await this.prisma.quote.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(q.status
          ? { status: q.status }
          : q.history === 'true'
            ? {}
            : { status: { not: 'SUPERSEDED' as const } }),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.dealId ? { dealId: q.dealId } : {}),
        ...(term ? { searchText: { contains: term } } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      include: quoteInclude,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const today = tehranToday();
    const items = rows.slice(0, q.limit).map((r) => {
      const { items: _i, notes: _n, terms: _t, ...summary } = toQuoteDto(r, r.version, today);
      return summary;
    });
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<QuoteDto> {
    const q = await this.prisma.quote.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: quoteInclude,
    });
    if (!q) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    return toQuoteDto(q, await this.latestVersion(actor.organizationId, q.seq));
  }

  /** Every version of one quote number, newest first. */
  async versions(actor: AuthUser, id: string) {
    const q = await this.prisma.quote.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      select: { seq: true },
    });
    if (!q) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    const rows = await this.prisma.quote.findMany({
      where: { organizationId: actor.organizationId, seq: q.seq, deletedAt: null },
      include: quoteInclude,
      orderBy: { version: 'desc' },
    });
    return rows.map((r) => {
      const { items: _i, notes: _n, terms: _t, ...summary } = toQuoteDto(r, rows[0]!.version);
      return summary;
    });
  }

  private async assertRefs(
    actor: AuthUser,
    refs: { customerId: string; contactId?: string | null; dealId?: string | null },
    items?: QuoteItemInput[],
  ) {
    const org = actor.organizationId;
    const customer = await this.prisma.customer.findFirst({
      where: { id: refs.customerId, organizationId: org, deletedAt: null },
      select: { id: true },
    });
    if (!customer)
      throw new BadRequestException({ code: 'INVALID_CUSTOMER', message: 'مشتری نامعتبر است' });
    if (refs.contactId) {
      const c = await this.prisma.contact.findFirst({
        where: {
          id: refs.contactId,
          organizationId: org,
          customerId: refs.customerId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!c)
        throw new BadRequestException({ code: 'INVALID_CONTACT', message: 'مخاطب نامعتبر است' });
    }
    if (refs.dealId) {
      const d = await this.prisma.deal.findFirst({
        where: {
          id: refs.dealId,
          organizationId: org,
          customerId: refs.customerId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!d) throw new BadRequestException({ code: 'INVALID_DEAL', message: 'فرصت نامعتبر است' });
    }
    const productIds = [
      ...new Set((items ?? []).map((i) => i.productId).filter(Boolean)),
    ] as string[];
    if (productIds.length) {
      const found = await this.prisma.product.count({
        where: { id: { in: productIds }, organizationId: org },
      });
      if (found !== productIds.length) {
        throw new BadRequestException({ code: 'INVALID_PRODUCT', message: 'محصول نامعتبر است' });
      }
    }
  }

  private searchText(v: { title: string; number: string; customerName: string }) {
    return normalizeText(`${v.number} ${v.title} ${v.customerName}`);
  }

  async create(actor: AuthUser, dto: CreateQuoteRequest, ip?: string): Promise<QuoteDto> {
    await this.assertRefs(actor, dto, dto.items);
    const totals = calculateQuoteTotals(lines(dto.items), parseRial(dto.discount), dto.taxRateBp);
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { id: dto.customerId },
      select: { name: true },
    });
    const quote = await this.prisma.$transaction(async (tx) => {
      const seq = await nextSequence(tx, actor.organizationId, 'quote');
      return tx.quote.create({
        data: {
          organizationId: actor.organizationId,
          seq,
          title: dto.title,
          customerId: dto.customerId,
          contactId: dto.contactId ?? null,
          dealId: dto.dealId ?? null,
          ownerId: actor.id,
          createdById: actor.id,
          issueDate: dateOnly(dto.issueDate ?? tehranToday()),
          validUntil: dto.validUntil ? dateOnly(dto.validUntil) : null,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxRateBp: dto.taxRateBp,
          taxAmount: totals.taxAmount,
          total: totals.total,
          notes: dto.notes ?? null,
          terms: dto.terms ?? null,
          searchText: this.searchText({
            title: dto.title,
            number: quoteNumber(seq),
            customerName: customer.name,
          }),
          items: {
            create: dto.items.map((i, idx) => ({
              position: idx,
              productId: i.productId ?? null,
              description: i.description,
              quantity: i.quantity,
              unitPrice: parseRial(i.unitPrice),
              lineTotal: BigInt(i.quantity) * parseRial(i.unitPrice),
            })),
          },
        },
      });
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'quote.created',
      entityType: 'quote',
      entityId: quote.id,
      metadata: { number: quoteNumber(quote.seq), total: quote.total.toString() },
      ip,
    });
    return this.get(actor, quote.id);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateQuoteRequest,
    ip?: string,
  ): Promise<QuoteDto> {
    const existing = await this.prisma.quote.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: { items: true, customer: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    if (existing.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'QUOTE_LOCKED',
        message: 'فقط پیش‌فاکتور پیش‌نویس قابل ویرایش است؛ برای تغییر، نسخه جدید بسازید',
      });
    }
    const customerId = dto.customerId ?? existing.customerId;
    const customerChanged = customerId !== existing.customerId;
    const contactId =
      dto.contactId === undefined ? (customerChanged ? null : existing.contactId) : dto.contactId;
    const dealId =
      dto.dealId === undefined ? (customerChanged ? null : existing.dealId) : dto.dealId;
    await this.assertRefs(actor, { customerId, contactId, dealId }, dto.items);

    const items: QuoteItemInput[] =
      dto.items ??
      existing.items.map((i) => ({
        productId: i.productId,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
      }));
    const discount = dto.discount !== undefined ? parseRial(dto.discount) : existing.discount;
    const taxRateBp = dto.taxRateBp ?? existing.taxRateBp;
    let totals;
    try {
      totals = calculateQuoteTotals(lines(items), discount, taxRateBp);
    } catch (e) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNTS',
        message: e instanceof Error ? e.message : 'مبالغ نامعتبر است',
      });
    }
    const issueDate = dto.issueDate ? dateOnly(dto.issueDate) : existing.issueDate;
    const validUntil =
      dto.validUntil === undefined
        ? existing.validUntil
        : dto.validUntil
          ? dateOnly(dto.validUntil)
          : null;
    if (validUntil && validUntil < issueDate) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'اعتبار پیش‌فاکتور نمی‌تواند پیش از تاریخ صدور باشد',
      });
    }
    const title = dto.title ?? existing.title;
    const customerName = customerChanged
      ? (
          await this.prisma.customer.findFirstOrThrow({
            where: { id: customerId },
            select: { name: true },
          })
        ).name
      : existing.customer.name;
    await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
        await tx.quoteItem.createMany({
          data: dto.items.map((i, idx) => ({
            quoteId: id,
            position: idx,
            productId: i.productId ?? null,
            description: i.description,
            quantity: i.quantity,
            unitPrice: parseRial(i.unitPrice),
            lineTotal: BigInt(i.quantity) * parseRial(i.unitPrice),
          })),
        });
      }
      await tx.quote.update({
        where: { id },
        data: {
          title,
          customerId,
          contactId,
          dealId,
          issueDate,
          validUntil,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxRateBp,
          taxAmount: totals.taxAmount,
          total: totals.total,
          notes: dto.notes === undefined ? undefined : dto.notes || null,
          terms: dto.terms === undefined ? undefined : dto.terms || null,
          searchText: this.searchText({ title, number: quoteNumber(existing.seq), customerName }),
        },
      });
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'quote.updated',
      entityType: 'quote',
      entityId: id,
      ip,
    });
    return this.get(actor, id);
  }

  async transition(actor: AuthUser, id: string, to: QuoteStatus, ip?: string): Promise<QuoteDto> {
    const q = await this.prisma.quote.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!q) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    if (!QUOTE_TRANSITIONS[q.status].includes(to)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'این تغییر وضعیت برای پیش‌فاکتور مجاز نیست',
      });
    }
    if (
      to === 'ACCEPTED' &&
      q.validUntil &&
      q.validUntil.toISOString().slice(0, 10) < tehranToday()
    ) {
      throw new ConflictException({
        code: 'QUOTE_EXPIRED',
        message: 'اعتبار پیش‌فاکتور تمام شده است؛ نسخه جدید بسازید',
      });
    }
    const now = new Date();
    const eventId = await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id },
        data: to === 'SENT' ? { status: to, sentAt: now } : { status: to, decidedAt: now },
      });
      if (to !== 'ACCEPTED' && to !== 'REJECTED') return null;
      return this.events.emit(tx, {
        organizationId: actor.organizationId,
        type: to === 'ACCEPTED' ? 'quote.accepted' : 'quote.rejected',
        entityType: 'quote',
        entityId: id,
        actorId: actor.id,
        payload: {
          number: quoteNumber(q.seq),
          title: q.title,
          customerId: q.customerId,
          total: q.total.toString(),
          ownerId: q.ownerId,
        },
      });
    });
    if (eventId) await this.events.publish([eventId]);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: `quote.${to.toLowerCase()}`,
      entityType: 'quote',
      entityId: id,
      metadata: { number: quoteNumber(q.seq), version: q.version },
      ip,
    });
    return this.get(actor, id);
  }

  /** New DRAFT version of a SENT/REJECTED quote; the old version becomes SUPERSEDED. */
  async revise(actor: AuthUser, id: string, ip?: string): Promise<QuoteDto> {
    const q = await this.prisma.quote.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!q) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    if (q.status !== 'SENT' && q.status !== 'REJECTED') {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'فقط پیش‌فاکتور ارسال‌شده یا ردشده نسخه جدید می‌گیرد',
      });
    }
    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the row so two concurrent revisions cannot both create version + 1.
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text FROM quotes WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked[0]?.status !== q.status) {
        throw new ConflictException({ code: 'CONFLICT', message: 'پیش‌فاکتور هم‌زمان تغییر کرد' });
      }
      await tx.quote.update({ where: { id }, data: { status: 'SUPERSEDED' } });
      const latest = await tx.quote.aggregate({
        where: { organizationId: q.organizationId, seq: q.seq },
        _max: { version: true },
      });
      return tx.quote.create({
        data: {
          organizationId: q.organizationId,
          seq: q.seq,
          version: (latest._max.version ?? q.version) + 1,
          title: q.title,
          customerId: q.customerId,
          contactId: q.contactId,
          dealId: q.dealId,
          ownerId: q.ownerId,
          createdById: actor.id,
          issueDate: dateOnly(tehranToday()),
          validUntil: null,
          subtotal: q.subtotal,
          discount: q.discount,
          taxRateBp: q.taxRateBp,
          taxAmount: q.taxAmount,
          total: q.total,
          notes: q.notes,
          terms: q.terms,
          searchText: q.searchText,
          items: {
            create: q.items.map((i) => ({
              position: i.position,
              productId: i.productId,
              description: i.description,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              lineTotal: i.lineTotal,
            })),
          },
        },
      });
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'quote.revised',
      entityType: 'quote',
      entityId: created.id,
      metadata: { number: quoteNumber(q.seq), from: q.version, to: created.version },
      ip,
    });
    return this.get(actor, created.id);
  }

  async remove(actor: AuthUser, id: string, ip?: string): Promise<void> {
    const q = await this.prisma.quote.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!q) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    if (q.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'QUOTE_LOCKED',
        message: 'فقط پیش‌فاکتور پیش‌نویس حذف می‌شود',
      });
    }
    await this.prisma.quote.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'quote.deleted',
      entityType: 'quote',
      entityId: id,
      ip,
    });
  }
}
