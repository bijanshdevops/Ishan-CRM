import { z } from 'zod';

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است');
const RialString = z.string().regex(/^\d{1,15}$/, 'مبلغ نامعتبر است');
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

// ---- Lead sources -----------------------------------------------------------
export const CreateLeadSourceRequestSchema = z.strictObject({
  name: z.string().trim().min(2, 'نام باید حداقل ۲ نویسه باشد').max(60),
});
export type CreateLeadSourceRequest = z.infer<typeof CreateLeadSourceRequestSchema>;

export const UpdateLeadSourceRequestSchema = z.strictObject({
  name: z.string().trim().min(2).max(60).optional(),
  active: z.boolean().optional(),
});
export type UpdateLeadSourceRequest = z.infer<typeof UpdateLeadSourceRequestSchema>;

export interface LeadSourceDto {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

/** Sources every new organization starts with (configuration, editable by admins). */
export const DEFAULT_LEAD_SOURCES = [
  'وب‌سایت',
  'معرفی مشتری',
  'تماس ورودی',
  'نمایشگاه',
  'شبکه‌های اجتماعی',
] as const;

// ---- Campaigns --------------------------------------------------------------
export const CAMPAIGN_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELED'] as const;
export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

function checkDates(
  v: { startDate?: string | null; endDate?: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({ code: 'custom', message: 'پایان کمپین نمی‌تواند پیش از شروع باشد' });
  }
}

export const CreateCampaignRequestSchema = z
  .strictObject({
    name: z.string().trim().min(2, 'نام باید حداقل ۲ نویسه باشد').max(150),
    channel: optText(60),
    status: CampaignStatusSchema.default('PLANNED'),
    startDate: DateOnly.optional(),
    endDate: DateOnly.optional(),
    /** Integer rials. */
    budget: RialString.default('0'),
    ownerId: z.string().uuid().nullable().optional(),
    notes: optText(4000),
  })
  .superRefine(checkDates);
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequestSchema>;

/** No defaults: a partial update must not reset fields the caller did not send. */
export const UpdateCampaignRequestSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(150).optional(),
    channel: nullableText(60),
    status: CampaignStatusSchema.optional(),
    startDate: DateOnly.nullable().optional(),
    endDate: DateOnly.nullable().optional(),
    budget: RialString.optional(),
    ownerId: z.string().uuid().nullable().optional(),
    notes: nullableText(4000),
  })
  .superRefine(checkDates);
export type UpdateCampaignRequest = z.infer<typeof UpdateCampaignRequestSchema>;

export const CampaignListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  status: CampaignStatusSchema.optional(),
});
export type CampaignListQuery = z.infer<typeof CampaignListQuerySchema>;

export interface CampaignDto {
  id: string;
  name: string;
  channel: string | null;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  /** Integer rials. */
  budget: string;
  owner: { id: string; name: string } | null;
  notes: string | null;
  leadCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Reports ----------------------------------------------------------------
export interface CampaignRoiRowDto {
  campaignId: string;
  name: string;
  status: CampaignStatus;
  /** Integer rials. */
  budget: string;
  leads: number;
  converted: number;
  /** Deals opened from this campaign's leads that reached a won stage. */
  wonDeals: number;
  /** Integer rials: total of those won deals. */
  wonAmount: string;
  /** Integer rials: budget / leads (rounded down); null without leads. */
  costPerLead: string | null;
  /** Return on investment in basis points: (won - budget) / budget; null without a budget. */
  roiBp: number | null;
}

export interface LeadSourceRowDto {
  sourceId: string | null;
  name: string;
  leads: number;
  converted: number;
  /** Converted / leads in basis points. */
  conversionBp: number;
}

/** (won - budget) / budget in basis points, rounded toward zero; null without a budget. */
export function roiBasisPoints(wonAmount: bigint, budget: bigint): number | null {
  if (budget <= 0n) return null;
  return Number(((wonAmount - budget) * 10_000n) / budget);
}
