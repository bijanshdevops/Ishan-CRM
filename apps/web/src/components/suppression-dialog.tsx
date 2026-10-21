'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type SuppressionDto } from '@ishan/contracts';
import { fa, formatJalaliDate } from '@ishan/i18n';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from './toast';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Skeleton,
  Td,
  Tr,
} from './ui';

const t = fa.campaignSending;
const KEY = ['marketing-suppressions'];
const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

/** Addresses that never get campaign mail: unsubscribed, bounced, or added by hand. */
export function SuppressionDialog({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(PERMISSIONS.CAMPAIGNS_WRITE);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => api<SuppressionDto[]>('/marketing/suppressions'),
  });
  const add = useMutation({
    mutationFn: () => api('/marketing/suppressions', { method: 'POST', body: { email } }),
    onSuccess: () => {
      setError(null);
      setEmail('');
      toast(t.suppressionAdded);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setError(msg(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/marketing/suppressions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(t.suppressionRemoved);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setError(msg(e)),
  });

  return (
    <Modal title={t.suppressionsTitle} onClose={onClose}>
      <p className="text-sm text-[var(--color-text-muted)]">{t.suppressionsHint}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {canWrite ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) add.mutate();
          }}
        >
          <Field label={t.suppressionEmail}>
            {(p) => (
              <Input
                {...p}
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" loading={add.isPending}>
            {t.suppressionAdd}
          </Button>
        </form>
      ) : null}
      {list.isLoading ? (
        <Skeleton rows={3} />
      ) : list.isError ? (
        <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState />
      ) : (
        <DataTable head={[t.suppressionEmail, t.reason, t.date, canWrite ? fa.common.actions : '']}>
          {(list.data ?? []).map((s) => (
            <Tr key={s.id}>
              <Td>
                <span dir="ltr">{s.email}</span>
              </Td>
              <Td>{t.reasons[s.reason]}</Td>
              <Td>{formatJalaliDate(s.createdAt)}</Td>
              <Td>
                {canWrite ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(t.suppressionRemoveConfirm)) remove.mutate(s.id);
                    }}
                  >
                    {fa.common.delete}
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
        </DataTable>
      )}
      <div>
        <Button variant="ghost" onClick={onClose}>
          {fa.common.close}
        </Button>
      </div>
    </Modal>
  );
}
