'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  DOMAIN_EVENT_TYPES,
  type DomainEventType,
  type WebhookDto,
  type WebhookWithSecretDto,
} from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { ApiClientError, api } from '@/lib/api';
import {
  emptyWebhookForm,
  toggleEvent,
  validateWebhookForm,
  type WebhookFormErrors,
  type WebhookFormState,
} from '@/lib/webhook-form';
import { Button, Card, ErrorBanner, Field, Input } from './ui';

const t = fa.webhooks;

/** Create (no `webhook`) or edit. Creation returns the one-time secret to `onSaved`. */
export function WebhookForm({
  webhook,
  readOnly = false,
  onSaved,
}: {
  webhook?: WebhookDto;
  readOnly?: boolean;
  onSaved: (saved: WebhookDto | WebhookWithSecretDto) => void | Promise<void>;
}) {
  const [f, setF] = useState<WebhookFormState>(
    webhook
      ? { name: webhook.name, url: webhook.url, eventTypes: webhook.eventTypes }
      : emptyWebhookForm(),
  );
  const [errors, setErrors] = useState<WebhookFormErrors>({});
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      webhook
        ? api<WebhookDto>(`/webhooks/${webhook.id}`, {
            method: 'PATCH',
            body,
            version: webhook.updatedAt,
          })
        : api<WebhookWithSecretDto>('/webhooks', { method: 'POST', body }),
    onSuccess: (saved) => onSaved(saved),
    onError: (e) =>
      setError(
        e instanceof ApiClientError ? (e.status === 412 ? t.stale : e.message) : fa.common.error,
      ),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = validateWebhookForm(f);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    save.mutate(r.request);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label={t.name} error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  value={f.name}
                  maxLength={120}
                  onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))}
                />
              )}
            </Field>
            <Field label={t.url} hint={t.urlHint} error={errors.url}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="url"
                  value={f.url}
                  onChange={(e) => setF((s) => ({ ...s, url: e.target.value }))}
                />
              )}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t.events}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {DOMAIN_EVENT_TYPES.map((type: DomainEventType) => (
                  <label key={type} className="flex min-h-10 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={f.eventTypes.includes(type)}
                      onChange={() =>
                        setF((s) => ({
                          ...s,
                          eventTypes: toggleEvent(s.eventTypes, type, DOMAIN_EVENT_TYPES),
                        }))
                      }
                    />
                    {fa.workflows.triggers[type] ?? type}
                  </label>
                ))}
              </div>
              {errors.eventTypes ? (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  {errors.eventTypes}
                </p>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">{t.eventsHint}</p>
              )}
            </fieldset>
          </div>
        </Card>
      </fieldset>
      {error ? <ErrorBanner message={error} /> : null}
      {readOnly ? null : (
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            {t.save}
          </Button>
        </div>
      )}
    </form>
  );
}
