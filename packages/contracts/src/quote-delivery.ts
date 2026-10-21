import { z } from 'zod';

/** PDF and e-mail delivery of quotes (ADR 0016). */

export const QUOTE_EMAIL_PER_HOUR = 20;
export const QUOTE_EMAIL_MESSAGE_MAX = 2000;
export const QUOTE_EMAIL_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type QuoteEmailStatus = (typeof QUOTE_EMAIL_STATUSES)[number];
/** Statuses a quote may be e-mailed in (never a draft). */
export const QUOTE_EMAILABLE_STATUSES = ['SENT', 'ACCEPTED'] as const;

export const SendQuoteEmailSchema = z.strictObject({
  to: z.string().trim().toLowerCase().email().max(254),
  message: z
    .string()
    .trim()
    .max(QUOTE_EMAIL_MESSAGE_MAX)
    .optional()
    .transform((v) => (v ? v : null)),
});
export type SendQuoteEmail = z.infer<typeof SendQuoteEmailSchema>;

export interface QuoteEmailRecipientDto {
  email: string;
  /** Who the address belongs to, e.g. the customer or the quote's contact. */
  label: string;
}

export interface QuoteEmailOptionsDto {
  /** SMTP is configured on the server. */
  emailAvailable: boolean;
  /** The PDF renderer is installed on the server. */
  pdfAvailable: boolean;
  /** The caller's verified address, used as Reply-To; null = they cannot send. */
  replyTo: string | null;
  /** Only addresses already on the customer's file may receive the quote. */
  recipients: QuoteEmailRecipientDto[];
}

export interface QuoteEmailDto {
  id: string;
  quoteId: string;
  version: number;
  to: string;
  message: string | null;
  status: QuoteEmailStatus;
  attempt: number;
  lastError: string | null;
  sender: { id: string; name: string } | null;
  sentAt: string | null;
  createdAt: string;
}
