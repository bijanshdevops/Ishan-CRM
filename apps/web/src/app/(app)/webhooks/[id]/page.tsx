'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PERMISSIONS,
  WEBHOOK_TEST_EVENT_TYPE,
  type Page,
  type WebhookDeliveryDto,
  type WebhookDeliveryStatus,
  type WebhookDto,
  type WebhookWithSecretDto,
} from '@ishan/contracts';
import { fa, formatJalaliDateTime, formatNumber } from '@ishan/i18n';
import { SecretDialog } from '@/components/secret-dialog';
import { useToast } from '@/components/toast';
import { WebhookForm } from '@/components/webhook-form';
import { WebhookStatus } from '@/components/webhook-status';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const t = fa.webhooks;
const msg = (e: unknown) => (e instanceof ApiClientError ? e.message : fa.common.error);
const TONE = { PENDING: 'neutral', SUCCEEDED: 'success', FAILED: 'danger' } as const;

function Deliveries({ id, canWrite }: { id: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<WebhookDeliveryStatus | ''>('');
  const list = useInfiniteQuery({
    queryKey: ['webhook-deliveries', id, status],
    initialPageParam: undefined as string | undefined,
    // Deliveries move from pending to done on their own; keep the table fresh.
    refetchInterval: 5_000,
    queryFn: ({ pageParam }) =>
      api<Page<WebhookDeliveryDto>>(
        `/webhooks/${id}/deliveries?limit=20${status ? `&status=${status}` : ''}${
          pageParam ? `&cursor=${pageParam}` : ''
        }`,
      ),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const redeliver = useMutation({
    mutationFn: (deliveryId: string) =>
      api<WebhookDeliveryDto>(`/webhooks/deliveries/${deliveryId}/redeliver`, { method: 'POST' }),
    onSuccess: async () => {
      toast(t.redelivered);
      await qc.invalidateQueries({ queryKey: ['webhook-deliveries', id] });
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  return (
    <Card
      title={t.deliveries}
      actions={
        <div className="w-40">
          <Select
            aria-label={t.result}
            value={status}
            onChange={(e) => setStatus(e.target.value as WebhookDeliveryStatus | '')}
          >
            <option value="">{t.all}</option>
            {(['SUCCEEDED', 'FAILED', 'PENDING'] as const).map((s) => (
              <option key={s} value={s}>
                {t.deliveryStatus[s]}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      {list.isLoading ? (
        <Skeleton rows={3} />
      ) : list.isError ? (
        <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState>{t.deliveriesEmpty}</EmptyState>
      ) : (
        <DataTable head={[t.time, t.event, t.result, t.attempt, t.code, t.detail, '']}>
          {items.map((d) => (
            <Tr key={d.id}>
              <Td>{formatJalaliDateTime(d.createdAt)}</Td>
              <Td>
                {d.eventType === WEBHOOK_TEST_EVENT_TYPE
                  ? t.testEvent
                  : ((fa.workflows.triggers as Record<string, string>)[d.eventType] ?? d.eventType)}
              </Td>
              <Td>
                <Badge tone={TONE[d.status]}>{t.deliveryStatus[d.status]}</Badge>
              </Td>
              <Td>{formatNumber(d.attempt)}</Td>
              <Td>
                <span dir="ltr">{d.lastStatusCode ?? '—'}</span>
              </Td>
              <Td className="max-w-[16rem] text-[var(--color-text-muted)]">
                {d.lastError ?? ''}
                {d.status === 'PENDING' && d.nextAttemptAt && d.attempt > 0 ? (
                  <span className="block">
                    {t.nextAttempt(formatJalaliDateTime(d.nextAttemptAt))}
                  </span>
                ) : null}
              </Td>
              <Td>
                {canWrite && d.status !== 'PENDING' ? (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-3"
                    loading={redeliver.isPending && redeliver.variables === d.id}
                    onClick={() => redeliver.mutate(d.id)}
                  >
                    {t.redeliver}
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
        </DataTable>
      )}
      {list.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {fa.common.more}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export default function WebhookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(PERMISSIONS.WEBHOOKS_WRITE);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const hook = useQuery({
    queryKey: ['webhook', id],
    queryFn: () => api<WebhookDto>(`/webhooks/${id}`),
  });

  const toggle = useMutation({
    mutationFn: (w: WebhookDto) =>
      api<WebhookDto>(`/webhooks/${w.id}/${w.enabled ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: async (w) => {
      toast(w.enabled ? t.enabledToast : t.disabledToast);
      qc.setQueryData(['webhook', id], w);
      await qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const ping = useMutation({
    mutationFn: () => api<WebhookDeliveryDto>(`/webhooks/${id}/test`, { method: 'POST' }),
    onSuccess: async () => {
      toast(t.testQueued);
      await qc.invalidateQueries({ queryKey: ['webhook-deliveries', id] });
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const rotate = useMutation({
    mutationFn: () =>
      api<WebhookWithSecretDto>(`/webhooks/${id}/rotate-secret`, { method: 'POST' }),
    onSuccess: async (w) => {
      setConfirmRotate(false);
      setSecret(w.secret);
      const { secret: _drop, ...dto } = w;
      qc.setQueryData(['webhook', id], dto);
      await qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  if (hook.isLoading) return <Skeleton />;
  if (hook.isError || !hook.data) {
    return <ErrorBanner message={msg(hook.error)} onRetry={() => void hook.refetch()} />;
  }
  const w = hook.data;
  return (
    <>
      <PageHeader
        title={w.name}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <WebhookStatus w={w} />
            {canWrite ? (
              <>
                <Button
                  variant="secondary"
                  loading={ping.isPending}
                  disabled={!w.enabled}
                  onClick={() => ping.mutate()}
                >
                  {t.test}
                </Button>
                <Button
                  variant="secondary"
                  loading={toggle.isPending}
                  onClick={() => toggle.mutate(w)}
                >
                  {w.enabled ? t.disable : t.enable}
                </Button>
              </>
            ) : null}
            <Link href="/webhooks" className="text-sm text-[var(--color-brand)] hover:underline">
              {t.title}
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <Card
          title={t.secret}
          actions={
            canWrite ? (
              <Button variant="secondary" onClick={() => setConfirmRotate(true)}>
                {t.rotate}
              </Button>
            ) : undefined
          }
        >
          <p className="text-sm">
            <span dir="ltr" className="font-mono" data-testid="secret-hint">
              whsec_{t.secretHint(w.secretHint)}
            </span>
          </p>
          {w.previousSecretExpiresAt ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t.graceUntil(formatJalaliDateTime(w.previousSecretExpiresAt))}
            </p>
          ) : null}
        </Card>
        <WebhookForm
          key={w.updatedAt}
          webhook={w}
          readOnly={!canWrite}
          onSaved={async (saved) => {
            qc.setQueryData(['webhook', id], saved);
            await qc.invalidateQueries({ queryKey: ['webhooks'] });
            toast(t.saved);
          }}
        />
        <Deliveries id={id} canWrite={canWrite} />
      </div>
      {confirmRotate ? (
        <Modal title={t.rotateTitle} onClose={() => setConfirmRotate(false)}>
          <p className="text-sm text-[var(--color-text-muted)]">{t.rotateBody}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmRotate(false)}>
              {fa.common.cancel}
            </Button>
            <Button loading={rotate.isPending} onClick={() => rotate.mutate()}>
              {t.rotateConfirm}
            </Button>
          </div>
        </Modal>
      ) : null}
      {secret ? (
        <SecretDialog title={t.secretTitle} secret={secret} onDone={() => setSecret(null)} />
      ) : null}
    </>
  );
}
