'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { NotificationPreferencesDto } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { ApiClientError, api } from '@/lib/api';
import { useToast } from './toast';
import { Badge, Button, Card, ErrorBanner } from './ui';

const t = fa.account;
const KEY = ['notification-preferences'];
const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

/** Personal e-mail switch. Rendered only when the server has SMTP configured. */
export function NotificationEmailCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const prefs = useQuery({
    queryKey: KEY,
    queryFn: () => api<NotificationPreferencesDto>('/account/notification-preferences'),
  });
  const update = useMutation({
    mutationFn: (emailEnabled: boolean) =>
      api<NotificationPreferencesDto>('/account/notification-preferences', {
        method: 'PUT',
        body: { emailEnabled },
      }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      toast(data.emailEnabled ? t.emailOn : t.emailOff);
    },
    onError: (e) => setError(msg(e)),
  });
  const test = useMutation({
    mutationFn: () => api('/account/notification-email/test', { method: 'POST' }),
    onSuccess: () => toast(t.emailTestSent),
    onError: (e) => setError(msg(e)),
  });

  const p = prefs.data;
  if (!p?.emailAvailable) return null;
  return (
    <Card
      title={t.emailTitle}
      actions={
        <Badge tone={p.emailEnabled ? 'success' : 'neutral'}>
          {p.emailEnabled ? t.mfaOn : t.mfaOff}
        </Badge>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm">{t.emailHint}</p>
        <code dir="ltr" className="w-fit rounded bg-[var(--color-surface-2)] px-2 py-1 text-sm">
          {p.email}
        </code>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={p.emailEnabled}
            disabled={update.isPending}
            onChange={(e) => {
              setError(null);
              update.mutate(e.target.checked);
            }}
          />
          {t.emailSwitch}
        </label>
        <div>
          <Button
            variant="ghost"
            loading={test.isPending}
            onClick={() => {
              setError(null);
              test.mutate();
            }}
          >
            {t.emailTest}
          </Button>
        </div>
      </div>
    </Card>
  );
}
