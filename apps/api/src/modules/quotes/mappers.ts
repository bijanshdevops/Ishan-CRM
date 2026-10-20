import type { ContractDto, ProductDto, QuoteDto, QuoteStatus } from '@ishan/contracts';
import type { Prisma } from '../../generated/prisma/client';

export const quoteNumber = (seq: number) => `QT-${String(seq).padStart(6, '0')}`;
export const contractNumber = (seq: number) => `CT-${String(seq).padStart(6, '0')}`;

const TEHRAN_OFFSET_MS = 210 * 60_000;
/** Today's calendar date in Tehran (the business calendar), `YYYY-MM-DD`. */
export const tehranToday = (now = Date.now()) =>
  new Date(now + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
export const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);

export const toProductDto = (p: {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  unitPrice: bigint;
  description: string | null;
  active: boolean;
  createdAt: Date;
}): ProductDto => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  unit: p.unit,
  unitPrice: p.unitPrice.toString(),
  description: p.description,
  active: p.active,
  createdAt: p.createdAt.toISOString(),
});

export const quoteInclude = {
  customer: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  deal: { select: { id: true, title: true } },
  owner: { select: { id: true, name: true } },
  items: { orderBy: { position: 'asc' } },
  contract: { select: { id: true, seq: true } },
} satisfies Prisma.QuoteInclude;

export type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

export function toQuoteDto(q: QuoteRow, latestVersion: number, today = tehranToday()): QuoteDto {
  const validUntil = day(q.validUntil);
  return {
    id: q.id,
    number: quoteNumber(q.seq),
    version: q.version,
    title: q.title,
    status: q.status as QuoteStatus,
    expired: q.status === 'SENT' && validUntil !== null && validUntil < today,
    customer: q.customer,
    contact: q.contact,
    deal: q.deal,
    owner: q.owner,
    issueDate: day(q.issueDate)!,
    validUntil,
    subtotal: q.subtotal.toString(),
    discount: q.discount.toString(),
    taxRateBp: q.taxRateBp,
    taxAmount: q.taxAmount.toString(),
    total: q.total.toString(),
    notes: q.notes,
    terms: q.terms,
    items: q.items.map((i) => ({
      id: i.id,
      position: i.position,
      productId: i.productId,
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toString(),
      lineTotal: i.lineTotal.toString(),
    })),
    contract: q.contract ? { id: q.contract.id, number: contractNumber(q.contract.seq) } : null,
    latestVersion,
    sentAt: q.sentAt?.toISOString() ?? null,
    decidedAt: q.decidedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

export const contractInclude = {
  customer: { select: { id: true, name: true } },
  quote: { select: { id: true, seq: true, version: true } },
} satisfies Prisma.ContractInclude;

export type ContractRow = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;

export function toContractDto(c: ContractRow): ContractDto {
  return {
    id: c.id,
    number: contractNumber(c.seq),
    title: c.title,
    status: c.status,
    customer: c.customer,
    quote: { id: c.quote.id, number: quoteNumber(c.quote.seq), version: c.quote.version },
    amount: c.amount.toString(),
    startDate: day(c.startDate)!,
    endDate: day(c.endDate),
    terms: c.terms,
    signedAt: c.signedAt?.toISOString() ?? null,
    closedAt: c.closedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
