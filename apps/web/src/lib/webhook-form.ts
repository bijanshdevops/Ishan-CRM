import {
  CreateWebhookRequestSchema,
  checkWebhookUrl,
  type CreateWebhookRequest,
  type DomainEventType,
} from '@ishan/contracts';
import { fa } from '@ishan/i18n';

export interface WebhookFormState {
  name: string;
  url: string;
  eventTypes: DomainEventType[];
}

export interface WebhookFormErrors {
  name?: string;
  url?: string;
  eventTypes?: string;
}

export const emptyWebhookForm = (): WebhookFormState => ({ name: '', url: '', eventTypes: [] });

/**
 * Same shape check the API applies. The scheme is judged leniently here (http://localhost is
 * syntactically fine); the server decides what is actually reachable and safe (SSRF rules).
 */
export function validateWebhookForm(
  f: WebhookFormState,
): { ok: true; request: CreateWebhookRequest } | { ok: false; errors: WebhookFormErrors } {
  const errors: WebhookFormErrors = {};
  const name = f.name.trim();
  const url = f.url.trim();
  if (name.length < 2) errors.name = fa.webhooks.nameRequired;
  if (!url || checkWebhookUrl(url, true) !== null) errors.url = fa.webhooks.invalidUrl;
  if (f.eventTypes.length === 0) errors.eventTypes = fa.webhooks.needEvent;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const parsed = CreateWebhookRequestSchema.safeParse({ name, url, eventTypes: f.eventTypes });
  if (!parsed.success) return { ok: false, errors: { name: fa.common.error } };
  return { ok: true, request: parsed.data };
}

/** Toggles one event type, keeping the catalog order so the request is stable. */
export function toggleEvent(
  current: DomainEventType[],
  type: DomainEventType,
  order: readonly DomainEventType[],
): DomainEventType[] {
  const next = new Set(current);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  return order.filter((t) => next.has(t));
}
