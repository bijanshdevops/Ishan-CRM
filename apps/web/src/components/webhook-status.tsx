'use client';

import type { WebhookDto } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { Badge } from './ui';

const t = fa.webhooks;

export function WebhookStatus({ w }: { w: WebhookDto }) {
  if (w.enabled) return <Badge tone="success">{t.enabled}</Badge>;
  return (
    <Badge tone={w.disabledReason === 'AUTO_FAILURES' ? 'danger' : 'neutral'}>
      {w.disabledReason === 'AUTO_FAILURES' ? t.autoDisabled : t.disabled}
    </Badge>
  );
}
