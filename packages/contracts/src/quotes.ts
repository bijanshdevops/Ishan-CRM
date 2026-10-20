import { z } from 'zod';

/** ISO-8601 calendar date (`YYYY-MM-DD`), Gregorian; Jalali is a UI concern. */
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است');
const RialString = z.string().regex(/^\d{1,15}$/, 'مبلغ نامعتبر است');
const optText = (max: number) => z.string().trim().max(max).optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

/** VAT is expressed in basis points (1000 = 10%). */
export const DEFAULT_TAX_RATE_BP = 1000;
export const MAX_QUOTE_ITEMS = 100;
export const MAX_QUANTITY = 1_000_000;

// ---- Totals (pure, shared by API and UI preview) ----------------------------
export interface QuoteLineInput {
  quantity: number;
  /** Integer rials. */
  unitPrice: bigint;
}
export interface QuoteTotals {
  subtotal: bigint;
  discount: bigint;
  taxableAmount: bigint;
  taxAmount: bigint;
  total: bigint;
}

/** Tax rounds half up to the nearest rial. Throws when the discount exceeds the subtotal. */
export function calculateQuoteTotals(
  lines: QuoteLineInput[],
  discount: bigint,
  taxRateBp: number,
): QuoteTotals {
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10_000) {
    throw new RangeError('نرخ مالیات نامعتبر است');
  }
  if (discount < 0n) throw new RangeError('تخفیف نمی‌تواند منفی باشد');
  let subtotal = 0n;
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QUANTITY) {
      throw new RangeError('تعداد نامعتبر است');
    }
    if (l.unitPrice < 0n) throw new RangeError('قیمت نمی‌تواند منفی باشد');
    subtotal += BigInt(l.quantity) * l.unitPrice;
  }
  if (discount > subtotal) throw new RangeError('تخفیف بیشتر از جمع اقلام است');
  const taxableAmount = subtotal - discount;
  const taxAmount = (taxableAmount * BigInt(taxRateBp) + 5_000n) / 10_000n;
  return { subtotal, discount, taxableAmount, taxAmount, total: taxableAmount + taxAmount };
}

// ---- Products ---------------------------------------------------------------
export const CreateProductRequestSchema = z.strictObject({
  name: z.string().trim().min(2, 'نام باید حداقل ۲ نویسه باشد').max(150),
  sku: z
    .string()
    .trim()
    .max(40)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  unit: z.string().trim().min(1).max(30).default('عدد'),
  unitPrice: RialString,
  description: optText(2000),
});
export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;

export const UpdateProductRequestSchema = z.strictObject({
  name: z.string().trim().min(2).max(150).optional(),
  sku: nullableText(40),
  unit: z.string().trim().min(1).max(30).optional(),
  unitPrice: RialString.optional(),
  description: nullableText(2000),
  active: z.boolean().optional(),
});
export type UpdateProductRequest = z.infer<typeof UpdateProductRequestSchema>;

export const ProductListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  /** `true` hides archived products (default for pickers). */
  activeOnly: z.enum(['true', 'false']).default('false'),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export interface ProductDto {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  unitPrice: string;
  description: string | null;
  active: boolean;
  createdAt: string;
}

// ---- Quotes -----------------------------------------------------------------
export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;
export const QuoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

/** Allowed manual transitions. Revising (new version) supersedes SENT/REJECTED quotes. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  SUPERSEDED: [],
};

export const QuoteItemInputSchema = z.strictObject({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1, 'شرح قلم الزامی است').max(300),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  unitPrice: RialString,
});
export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;

const quoteBody = {
  title: z.string().trim().min(2, 'عنوان باید حداقل ۲ نویسه باشد').max(200),
  customerId: z.string().uuid(),
  contactId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  issueDate: DateOnly.optional(),
  validUntil: DateOnly.nullable().optional(),
  discount: RialString.default('0'),
  taxRateBp: z.number().int().min(0).max(10_000).default(DEFAULT_TAX_RATE_BP),
  notes: optText(4000),
  terms: optText(8000),
  items: z.array(QuoteItemInputSchema).min(1, 'حداقل یک قلم لازم است').max(MAX_QUOTE_ITEMS),
};

function quoteRules(
  v: {
    issueDate?: string;
    validUntil?: string | null;
    discount: string;
    items: QuoteItemInput[];
    taxRateBp: number;
  },
  ctx: z.RefinementCtx,
) {
  if (v.issueDate && v.validUntil && v.validUntil < v.issueDate) {
    ctx.addIssue({ code: 'custom', message: 'اعتبار پیش‌فاکتور نمی‌تواند پیش از تاریخ صدور باشد' });
  }
  try {
    calculateQuoteTotals(
      v.items.map((i) => ({ quantity: i.quantity, unitPrice: BigInt(i.unitPrice) })),
      BigInt(v.discount),
      v.taxRateBp,
    );
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'مبالغ نامعتبر است' });
  }
}

export const CreateQuoteRequestSchema = z.strictObject(quoteBody).superRefine(quoteRules);
export type CreateQuoteRequest = z.infer<typeof CreateQuoteRequestSchema>;

/**
 * Only DRAFT quotes are editable. Fields are optional WITHOUT defaults (a default would
 * silently reset the discount/tax on a partial update); `items`, when given, replace the lines.
 */
export const UpdateQuoteRequestSchema = z
  .strictObject({
    title: quoteBody.title.optional(),
    customerId: quoteBody.customerId.optional(),
    contactId: quoteBody.contactId,
    dealId: quoteBody.dealId,
    issueDate: quoteBody.issueDate,
    validUntil: quoteBody.validUntil,
    discount: RialString.optional(),
    taxRateBp: z.number().int().min(0).max(10_000).optional(),
    notes: nullableText(4000),
    terms: nullableText(8000),
    items: quoteBody.items.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.issueDate && v.validUntil && v.validUntil < v.issueDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'اعتبار پیش‌فاکتور نمی‌تواند پیش از تاریخ صدور باشد',
      });
    }
    if (v.items) {
      quoteRules(
        {
          discount: v.discount ?? '0',
          items: v.items,
          taxRateBp: v.taxRateBp ?? DEFAULT_TAX_RATE_BP,
        },
        ctx,
      );
    }
  });
export type UpdateQuoteRequest = z.infer<typeof UpdateQuoteRequestSchema>;

export const QuoteListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  status: QuoteStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  /** Hide superseded versions (default) or show the whole history. */
  history: z.enum(['true', 'false']).default('false'),
});
export type QuoteListQuery = z.infer<typeof QuoteListQuerySchema>;

export const QuoteTransitionRequestSchema = z.strictObject({
  status: z.enum(['SENT', 'ACCEPTED', 'REJECTED']),
});
export type QuoteTransitionRequest = z.infer<typeof QuoteTransitionRequestSchema>;

export interface QuoteItemDto {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface QuoteDto {
  id: string;
  /** Human number shared by all versions, e.g. `QT-000012`. */
  number: string;
  version: number;
  title: string;
  status: QuoteStatus;
  /** SENT and past `validUntil` (computed at read time). */
  expired: boolean;
  customer: { id: string; name: string };
  contact: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  owner: { id: string; name: string } | null;
  issueDate: string;
  validUntil: string | null;
  subtotal: string;
  discount: string;
  taxRateBp: number;
  taxAmount: string;
  total: string;
  notes: string | null;
  terms: string | null;
  items: QuoteItemDto[];
  /** Contract created from this quote, if any. */
  contract: { id: string; number: string } | null;
  /** Latest version number of this quote number. */
  latestVersion: number;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QuoteSummaryDto = Omit<QuoteDto, 'items' | 'notes' | 'terms'>;

// ---- Contracts --------------------------------------------------------------
export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'TERMINATED'] as const;
export const ContractStatusSchema = z.enum(CONTRACT_STATUSES);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const CreateContractRequestSchema = z
  .strictObject({
    quoteId: z.string().uuid(),
    title: z.string().trim().min(2).max(200).optional(),
    startDate: DateOnly.optional(),
    endDate: DateOnly.nullable().optional(),
    terms: optText(16000),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', message: 'پایان قرارداد نمی‌تواند پیش از شروع باشد' });
    }
  });
export type CreateContractRequest = z.infer<typeof CreateContractRequestSchema>;

export const UpdateContractRequestSchema = z.strictObject({
  title: z.string().trim().min(2).max(200).optional(),
  startDate: DateOnly.optional(),
  endDate: DateOnly.nullable().optional(),
  terms: nullableText(16000),
});
export type UpdateContractRequest = z.infer<typeof UpdateContractRequestSchema>;

export const ContractListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  status: ContractStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
});
export type ContractListQuery = z.infer<typeof ContractListQuerySchema>;

export interface ContractDto {
  id: string;
  number: string;
  title: string;
  status: ContractStatus;
  customer: { id: string; name: string };
  quote: { id: string; number: string; version: number };
  /** Total of the accepted quote at signing time (integer rials). */
  amount: string;
  startDate: string;
  endDate: string | null;
  terms: string | null;
  signedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}
