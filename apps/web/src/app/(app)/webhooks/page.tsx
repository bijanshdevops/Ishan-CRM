'use client';

import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type Page, type WebhookDto } from '@ishan/contracts';
import { fa, formatNumber } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { WebhookStatus } from '@/components/webhook-status';

const t = fa.webhooks;
const msg = (e: unknown) => (e instanceof ApiClientError ? e.message : fa.common.error);

export default function WebhooksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(PERMISSIONS.WEBHOOKS_WRITE);
  const canDelete = can(PERMISSIONS.WEBHOOKS_DELETE);
  const [removing, setRemoving] = useState<WebhookDto | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['webhooks'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<WebhookDto>>(`/webhooks?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks'] });

  const toggle = useMutation({
    mutationFn: (w: WebhookDto) =>
      api<WebhookDto>(`/webhooks/${w.id}/${w.enabled ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: async (w) => {
      toast(w.enabled ? t.enabledToast : t.disabledToast);
      await refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast(t.deleted);
      setRemoving(null);
      await refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          canWrite ? (
            <Link
              href="/webhooks/new"
              className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-brand-contrast)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
            >
              {t.add}
            </Link>
          ) : undefined
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-[var(--color-text-muted)]">{t.intro}</p>
      <Card>
        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState>{t.empty}</EmptyState>
        ) : (
          <DataTable head={[t.name, t.url, t.events, t.status, '']}>
            {items.map((w) => (
              <Tr key={w.id}>
                <Td>
                  <Link
                    href={`/webhooks/${w.id}`}
                    className="font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {w.name}
                  </Link>
                </Td>
                <Td className="max-w-[18rem] truncate text-[var(--color-text-muted)]">
                  <span dir="ltr">{w.url}</span>
                </Td>
                <Td>{t.eventsCount(formatNumber(w.eventTypes.length))}</Td>
                <Td>
                  <WebhookStatus w={w} />
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {canWrite ? (
                      <Button
                        variant="secondary"
                        className="min-h-8 px-3"
                        loading={toggle.isPending && toggle.variables?.id === w.id}
                        onClick={() => toggle.mutate(w)}
                      >
                        {w.enabled ? t.disable : t.enable}
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        className="min-h-8 px-3"
                        onClick={() => setRemoving(w)}
                      >
                        {fa.common.delete}
                      </Button>
                    ) : null}
                  </div>
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
      {removing ? (
        <Modal title={t.confirmDelete} onClose={() => setRemoving(null)}>
          <p className="text-sm">
            <strong>{removing.name}</strong>
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">{t.confirmDeleteBody}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {fa.common.cancel}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate(removing.id)}
            >
              {fa.common.delete}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
