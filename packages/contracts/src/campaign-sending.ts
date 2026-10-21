import { z } from 'zod';

/** Marketing e-mail for campaigns (ADR 0015). */

export const CAMPAIGN_MAX_RECIPIENTS = 5000;
export const CAMPAIGN_SUBJECT_MAX = 200;
export const CAMPAIGN_BODY_MAX = 5000;
export const CAMPAIGN_TEST_PER_HOUR = 5;
export const CAMPAIGN_EMAIL_PER_MINUTE_DEFAULT = 60;

export const CAMPAIGN_SENDING_STATUSES = ['DRAFT', 'SENDING', 'DONE', 'CANCELED'] as const;
export type CampaignSendingStatus = (typeof CAMPAIGN_SENDING_STATUSES)[number];
export const CAMPAIGN_RECIPIENT_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];
export const SUPPRESSION_REASONS = ['UNSUBSCRIBED', 'BOUNCED', 'MANUAL'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** The only merge field a campaign text may use. */
export const CAMPAIGN_MERGE_FIELD = 'customerName';

/** Returns the unknown `{{fields}}` of a text (empty = fine). */
export function unknownCampaignFields(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (m[1] !== CAMPAIGN_MERGE_FIELD) bad.add(m[1] ?? '');
  }
  return [...bad];
}

/** Replaces `{{customerName}}`; the result is plain text (escaped later where it becomes HTML). */
export function renderCampaignText(text: string, customerName: string): string {
  return text.replace(/\{\{\s*customerName\s*\}\}/g, customerName);
}

const noUnknownFields = (v: string) => unknownCampaignFields(v).length === 0;
const fieldMessage = { message: 'فقط متغیر {{customerName}} مجاز است' };

export const CampaignAudienceSchema = z.strictObject({
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  kind: z.enum(['PERSON', 'ORGANIZATION']).nullable().default(null),
});
export type CampaignAudience = z.infer<typeof CampaignAudienceSchema>;

export const SaveCampaignSendingSchema = z.strictObject({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(CAMPAIGN_SUBJECT_MAX)
    .regex(/^[^\r\n]*$/, 'عنوان باید تک‌خطی باشد')
    .refine(noUnknownFields, fieldMessage),
  body: z.string().trim().min(1).max(CAMPAIGN_BODY_MAX).refine(noUnknownFields, fieldMessage),
  audience: CampaignAudienceSchema,
});
export type SaveCampaignSending = z.infer<typeof SaveCampaignSendingSchema>;

/** The caller states how many recipients they saw in the preview; a different count is refused. */
export const StartCampaignSendingSchema = z.strictObject({
  expectedRecipients: z.number().int().min(1).max(CAMPAIGN_MAX_RECIPIENTS),
});
export type StartCampaignSending = z.infer<typeof StartCampaignSendingSchema>;

export const CreateSuppressionSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type CreateSuppression = z.infer<typeof CreateSuppressionSchema>;

export const UnsubscribeSchema = z.strictObject({ token: z.string().min(20).max(1000) });
export type Unsubscribe = z.infer<typeof UnsubscribeSchema>;

export interface CampaignSendingDto {
  id: string;
  campaignId: string;
  subject: string;
  body: string;
  audience: CampaignAudience;
  status: CampaignSendingStatus;
  startedAt: string | null;
  finishedAt: string | null;
  counts: Record<CampaignRecipientStatus, number>;
}

export interface CampaignSendingState {
  /** False when the server has no SMTP; the whole feature is then unavailable. */
  emailAvailable: boolean;
  sending: CampaignSendingDto | null;
}

export interface CampaignPreviewDto {
  recipients: number;
  /** Matching addresses left out because they unsubscribed or bounced. */
  suppressed: number;
  sample: { subject: string; text: string };
}

export interface SuppressionDto {
  id: string;
  email: string;
  reason: SuppressionReason;
  createdAt: string;
}
