'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type WebhookWithSecretDto } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { SecretDialog } from '@/components/secret-dialog';
import { useToast } from '@/components/toast';
import { WebhookForm } from '@/components/webhook-form';
import { ErrorBanner, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function NewWebhookPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [created, setCreated] = useState<WebhookWithSecretDto | null>(null);

  return (
    <>
      <PageHeader title={fa.webhooks.addTitle} />
      {!can(PERMISSIONS.WEBHOOKS_WRITE) ? (
        <ErrorBanner message={fa.common.error} />
      ) : (
        <WebhookForm
          onSaved={async (w) => {
            await qc.invalidateQueries({ queryKey: ['webhooks'] });
            toast(fa.webhooks.created);
            setCreated(w as WebhookWithSecretDto);
          }}
        />
      )}
      {created ? (
        <SecretDialog
          title={fa.webhooks.secretTitle}
          secret={created.secret}
          onDone={() => router.push(`/webhooks/${created.id}`)}
        />
      ) : null}
    </>
  );
}
