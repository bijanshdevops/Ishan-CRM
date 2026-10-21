import { z } from 'zod';

/**
 * Domain events (ADR 0011). One closed catalog; every payload is a small strict object so a
 * programming error (a forgotten or misspelled field) fails at emit time, not in a workflow later.
 * Money is an integer-rial string, like on the wire everywhere else.
 */
const id = z.string().uuid();
const rial = z.string().regex(/^\d+$/);

export const DOMAIN_EVENT_PAYLOADS = {
  'lead.created': z.strictObject({
    name: z.string(),
    sourceId: id.nullable(),
    campaignId: id.nullable(),
    ownerId: id.nullable(),
  }),
  'lead.converted': z.strictObject({
    name: z.string(),
    customerId: id,
    dealId: id.nullable(),
    amount: rial.nullable(),
    ownerId: id.nullable(),
  }),
  'deal.created': z.strictObject({
    title: z.string(),
    customerId: id,
    stageId: id,
    amount: rial,
    ownerId: id.nullable(),
  }),
  'deal.stage_changed': z.strictObject({
    title: z.string(),
    customerId: id,
    fromStageId: id,
    stageId: id,
    stageKind: z.enum(['OPEN', 'WON', 'LOST']),
    amount: rial,
    ownerId: id.nullable(),
  }),
  'quote.accepted': z.strictObject({
    number: z.string(),
    title: z.string(),
    customerId: id,
    total: rial,
    ownerId: id.nullable(),
  }),
  'quote.rejected': z.strictObject({
    number: z.string(),
    title: z.string(),
    customerId: id,
    total: rial,
    ownerId: id.nullable(),
  }),
  'activity.overdue': z.strictObject({
    title: z.string(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']),
    assigneeId: id.nullable(),
    dueAt: z.string().datetime(),
    customerId: id.nullable(),
    dealId: id.nullable(),
  }),
  'contract.expiring': z.strictObject({
    number: z.string(),
    title: z.string(),
    customerId: id,
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    daysLeft: z.number().int().min(0),
    amount: rial,
  }),
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENT_PAYLOADS;
export const DOMAIN_EVENT_TYPES = Object.keys(DOMAIN_EVENT_PAYLOADS) as DomainEventType[];
export type DomainEventPayload<T extends DomainEventType> = z.infer<
  (typeof DOMAIN_EVENT_PAYLOADS)[T]
>;

/** Events a scheduler (not a user action) produces; each carries a `dedupeKey`. */
export const TIME_BASED_EVENT_TYPES = ['activity.overdue', 'contract.expiring'] as const;

/** Contracts ending within this many days raise `contract.expiring` once. */
export const CONTRACT_EXPIRY_WINDOW_DAYS = 30;

/** Hard cap on the serialized payload (also enforced by a CHECK constraint). */
export const MAX_EVENT_PAYLOAD_BYTES = 8192;
