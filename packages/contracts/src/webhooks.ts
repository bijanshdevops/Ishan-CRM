import { z } from 'zod';
import { DOMAIN_EVENT_TYPES, type DomainEventType } from './events';

/**
 * Outbound webhooks (ADR 0012). The envelope below is the public wire contract: fields may be
 * added to `data`, never removed or re-purposed without bumping `version`.
 */

export const WEBHOOK_NAME_MIN = 2;
export const WEBHOOK_NAME_MAX = 120;
export const WEBHOOK_URL_MAX = 2048;
/** Enabled endpoints per organization. */
export const WEBHOOK_MAX_ENDPOINTS = 20;
export const WEBHOOK_ENVELOPE_VERSION = 1;
export const WEBHOOK_TEST_EVENT_TYPE = 'webhook.test';
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/** Deliveries stuck in a row on one endpoint before it is switched off. */
export const WEBHOOK_AUTO_DISABLE_AFTER = 10;
/** Total attempts per delivery. */
export const WEBHOOK_MAX_ATTEMPTS = 7;
/** Minutes to wait after failed attempt N (1-based) before attempt N+1. */
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 30, 120, 360, 1440] as const;
/** The previous secret keeps signing for this long after a rotation. */
export const WEBHOOK_SECRET_GRACE_HOURS = 24;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 1_048_576;
export const WEBHOOK_RESPONSE_SNIPPET_CHARS = 500;
/** Receivers must reject signatures whose timestamp is older than this. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

export const WEBHOOK_DISABLED_REASONS = ['MANUAL', 'AUTO_FAILURES'] as const;
export type WebhookDisabledReason = (typeof WEBHOOK_DISABLED_REASONS)[number];

export const WEBHOOK_DELIVERY_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/** Delay before the next attempt after `attempt` (1-based) failed; `null` = give up. */
export function webhookRetryDelayMinutes(attempt: number): number | null {
  if (attempt >= WEBHOOK_MAX_ATTEMPTS) return null;
  return WEBHOOK_BACKOFF_MINUTES[attempt - 1] ?? null;
}

/** Syntax-only URL check shared by API and UI; network-level checks (SSRF) live in the API. */
export function checkWebhookUrl(raw: string, allowInsecureLocal = false): string | null {
  if (raw.length > WEBHOOK_URL_MAX) return 'آدرس بیش از حد طولانی است';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'آدرس معتبر نیست';
  }
  if (u.username || u.password) return 'آدرس نباید نام کاربری یا گذرواژه داشته باشد';
  if (u.hash) return 'آدرس نباید بخش # داشته باشد';
  if (u.protocol === 'https:') return null;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol === 'http:' && allowInsecureLocal && local) return null;
  return 'فقط آدرس https مجاز است';
}

const eventType = z.enum(DOMAIN_EVENT_TYPES as [DomainEventType, ...DomainEventType[]]);
const name = z.string().trim().min(WEBHOOK_NAME_MIN).max(WEBHOOK_NAME_MAX);
const url = z.string().trim().min(1).max(WEBHOOK_URL_MAX);
const eventTypes = z
  .array(eventType)
  .min(1)
  .max(DOMAIN_EVENT_TYPES.length)
  .refine((v) => new Set(v).size === v.length, 'نوع رویداد تکراری است');

export const CreateWebhookRequestSchema = z.strictObject({ name, url, eventTypes });
export const UpdateWebhookRequestSchema = z.strictObject({
  name: name.optional(),
  url: url.optional(),
  eventTypes: eventTypes.optional(),
});
export const WebhookDeliveryListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
});

export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;
export type WebhookDeliveryListQuery = z.infer<typeof WebhookDeliveryListQuerySchema>;

export interface WebhookDto {
  id: string;
  name: string;
  url: string;
  eventTypes: DomainEventType[];
  enabled: boolean;
  disabledReason: WebhookDisabledReason | null;
  consecutiveFailures: number;
  /** Last 4 characters of the current secret, enough to tell which one a receiver holds. */
  secretHint: string;
  previousSecretExpiresAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

/** Returned once, by create and rotate-secret; never again. */
export interface WebhookWithSecretDto extends WebhookDto {
  secret: string;
}

export interface WebhookDeliveryDto {
  id: string;
  endpointId: string;
  eventId: string | null;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  responseSnippet: string | null;
  durationMs: number | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookCatalogDto {
  eventTypes: DomainEventType[];
  envelopeVersion: number;
  maxAttempts: number;
  timeoutMs: number;
  signatureToleranceSeconds: number;
}

export function webhookCatalog(): WebhookCatalogDto {
  return {
    eventTypes: [...DOMAIN_EVENT_TYPES],
    envelopeVersion: WEBHOOK_ENVELOPE_VERSION,
    maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    timeoutMs: WEBHOOK_TIMEOUT_MS,
    signatureToleranceSeconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  };
}

export interface WebhookEnvelope {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  organizationId: string;
  entity: { type: string; id: string };
  data: unknown;
}

export function buildWebhookEnvelope(event: {
  id: string;
  type: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  occurredAt: Date;
  payload: unknown;
}): WebhookEnvelope {
  return {
    id: event.id,
    type: event.type,
    version: WEBHOOK_ENVELOPE_VERSION,
    occurredAt: event.occurredAt.toISOString(),
    organizationId: event.organizationId,
    entity: { type: event.entityType, id: event.entityId },
    data: event.payload,
  };
}
