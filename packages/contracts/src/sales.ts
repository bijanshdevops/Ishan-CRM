import { z } from 'zod';
import { EmailSchema } from './identity';
import { PhoneSchema } from './customers';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const optPhone = z
  .union([z.literal(''), PhoneSchema])
  .transform((v) => (v === '' ? undefined : v))
  .optional();
const optEmail = z
  .union([z.literal(''), EmailSchema])
  .transform((v) => (v === '' ? undefined : v))
  .optional();

// ---- Leads -------------------------------------------------------------
export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DISQUALIFIED',
  'CONVERTED',
] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const CreateLeadRequestSchema = z.object({
  name: z.string().trim().min(2, 'نام باید حداقل ۲ نویسه باشد').max(150),
  company: optText(150),
  email: optEmail,
  phone: optPhone,
  sourceId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  notes: optText(4000),
  ownerId: z.string().uuid().nullable().optional(),
});
export type CreateLeadRequest = z.infer<typeof CreateLeadRequestSchema>;

export const UpdateLeadRequestSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  company: nullableText(150),
  email: z
    .union([z.literal(''), EmailSchema])
    .nullable()
    .optional(),
  phone: z
    .union([z.literal(''), PhoneSchema])
    .nullable()
    .optional(),
  sourceId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  notes: nullableText(4000),
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED']).optional(),
  disqualifyReason: nullableText(300),
});
export type UpdateLeadRequest = z.infer<typeof UpdateLeadRequestSchema>;

export const LeadListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  status: LeadStatusSchema.optional(),
  ownerId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
});
export type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

export const ConvertLeadRequestSchema = z.object({
  /** Attach to an existing customer instead of creating one. */
  customerId: z.string().uuid().optional(),
  customerKind: z.enum(['PERSON', 'ORGANIZATION']).default('PERSON'),
  /** Optionally open a deal at the same time. */
  deal: z
    .object({
      title: z.string().trim().min(2).max(200),
      amount: z
        .string()
        .regex(/^\d{1,18}$/, 'مبلغ نامعتبر است')
        .default('0'),
      expectedCloseDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .optional(),
});
export type ConvertLeadRequest = z.infer<typeof ConvertLeadRequestSchema>;

export interface LeadDto {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  status: LeadStatus;
  owner: { id: string; name: string } | null;
  notes: string | null;
  disqualifyReason: string | null;
  convertedAt: string | null;
  convertedCustomerId: string | null;
  convertedDealId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Pipeline ----------------------------------------------------------
export const StageKindSchema = z.enum(['OPEN', 'WON', 'LOST']);
export type StageKind = z.infer<typeof StageKindSchema>;

export const CreateStageRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  probability: z.number().int().min(0).max(100).default(0),
  kind: StageKindSchema.default('OPEN'),
});
export const UpdateStageRequestSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  kind: StageKindSchema.optional(),
});
export const ReorderStagesRequestSchema = z.object({
  stageIds: z.array(z.string().uuid()).min(1).max(30),
});

export interface StageDto {
  id: string;
  name: string;
  position: number;
  probability: number;
  kind: StageKind;
  updatedAt: string;
}

/** Stages created for a new organization. These are configuration, not demo data. */
export const DEFAULT_STAGES: Array<Omit<StageDto, 'id' | 'position' | 'updatedAt'>> = [
  { name: 'شناسایی', probability: 10, kind: 'OPEN' },
  { name: 'ارزیابی نیاز', probability: 25, kind: 'OPEN' },
  { name: 'ارائه پیشنهاد', probability: 50, kind: 'OPEN' },
  { name: 'مذاکره', probability: 75, kind: 'OPEN' },
  { name: 'برنده شد', probability: 100, kind: 'WON' },
  { name: 'از دست رفت', probability: 0, kind: 'LOST' },
];

// ---- Deals -------------------------------------------------------------
const AmountSchema = z.string().regex(/^\d{1,18}$/, 'مبلغ نامعتبر است');
const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است');

export const CreateDealRequestSchema = z.object({
  title: z.string().trim().min(2, 'عنوان باید حداقل ۲ نویسه باشد').max(200),
  customerId: z.string().uuid(),
  contactId: z.string().uuid().nullable().optional(),
  stageId: z.string().uuid().optional(),
  amount: AmountSchema.default('0'),
  expectedCloseDate: DateOnlySchema.optional(),
  ownerId: z.string().uuid().nullable().optional(),
  notes: optText(4000),
});
export type CreateDealRequest = z.infer<typeof CreateDealRequestSchema>;

export const UpdateDealRequestSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  contactId: z.string().uuid().nullable().optional(),
  amount: AmountSchema.optional(),
  expectedCloseDate: DateOnlySchema.nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  notes: nullableText(4000),
});
export type UpdateDealRequest = z.infer<typeof UpdateDealRequestSchema>;

export const MoveDealRequestSchema = z.object({
  stageId: z.string().uuid(),
  lostReason: z.string().trim().max(300).optional(),
});

export const DealListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  stageId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
});
export type DealListQuery = z.infer<typeof DealListQuerySchema>;

export interface DealDto {
  id: string;
  title: string;
  customer: { id: string; name: string };
  contact: { id: string; name: string } | null;
  stage: StageDto;
  /** Integer rials as a decimal string. */
  amount: string;
  expectedCloseDate: string | null;
  owner: { id: string; name: string } | null;
  notes: string | null;
  lostReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FunnelDto {
  stages: Array<StageDto & { count: number; amount: string; weightedAmount: string }>;
  totals: {
    openCount: number;
    openAmount: string;
    weightedAmount: string;
    wonAmount: string;
    wonCount: number;
    lostCount: number;
  };
}
