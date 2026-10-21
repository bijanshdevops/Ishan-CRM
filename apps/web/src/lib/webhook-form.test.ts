import { DOMAIN_EVENT_TYPES } from '@ishan/contracts';
import { describe, expect, it } from 'vitest';
import { emptyWebhookForm, toggleEvent, validateWebhookForm } from './webhook-form';

describe('webhook form', () => {
  const good = {
    name: 'حسابداری',
    url: 'https://example.com/hook',
    eventTypes: ['deal.created' as const],
  };

  it('accepts a valid form and trims the text', () => {
    const r = validateWebhookForm({
      ...good,
      name: '  حسابداری ',
      url: ' https://example.com/hook ',
    });
    expect(r).toEqual({ ok: true, request: good });
  });

  it('reports every missing piece at once', () => {
    const r = validateWebhookForm(emptyWebhookForm());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['eventTypes', 'name', 'url']);
  });

  it.each([
    'not a url',
    'ftp://example.com/h',
    'https://u:p@example.com/h',
    'https://example.com/#x',
  ])('rejects the address %s', (url) => {
    const r = validateWebhookForm({ ...good, url });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.url).toBeTruthy();
  });

  it('leaves the real reachability decision to the server', () => {
    expect(validateWebhookForm({ ...good, url: 'http://localhost:9000/h' }).ok).toBe(true);
    expect(validateWebhookForm({ ...good, url: 'https://10.0.0.5/h' }).ok).toBe(true);
  });

  it('toggles events in catalog order', () => {
    const a = toggleEvent([], 'deal.created', DOMAIN_EVENT_TYPES);
    const b = toggleEvent(a, 'lead.created', DOMAIN_EVENT_TYPES);
    expect(b).toEqual(['lead.created', 'deal.created']);
    expect(toggleEvent(b, 'lead.created', DOMAIN_EVENT_TYPES)).toEqual(['deal.created']);
  });
});
