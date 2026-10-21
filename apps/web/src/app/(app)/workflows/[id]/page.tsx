'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PERMISSIONS,
  type Page,
  type WorkflowCatalogDto,
  type WorkflowDto,
  type WorkflowRunDto,
} from '@ishan/contracts';
import { fa, formatJalaliDateTime } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import { WorkflowForm } from '@/components/workflow-form';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const t = fa.workflows;
const msg = (e: unknown) => (e instanceof ApiClientError ? e.message : fa.common.error);
const STEP_TONE = { done: 'success', skipped: 'neutral', failed: 'danger' } as const;
const STEP_LABEL = { done: t.stepDone, skipped: t.stepSkipped, failed: t.stepFailed } as const;

function Runs({ id }: { id: string }) {
  const runs = useInfiniteQuery({
    queryKey: ['workflow-runs', id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<WorkflowRunDto>>(
        `/workflows/${id}/runs?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card title={t.runs}>
      {runs.isLoading ? (
        <Skeleton rows={3} />
      ) : runs.isError ? (
        <ErrorBanner message={msg(runs.error)} onRetry={() => void runs.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState>{t.runsEmpty}</EmptyState>
      ) : (
        <DataTable head={[t.runTime, t.runStatus, t.runDetails]}>
          {items.map((r) => (
            <Tr key={r.id}>
              <Td>{formatJalaliDateTime(r.startedAt)}</Td>
              <Td>
                <Badge tone={r.status === 'SUCCEEDED' ? 'success' : 'danger'}>
                  {r.status === 'SUCCEEDED' ? t.succeeded : t.failed}
                </Badge>
              </Td>
              <Td>
                <ul className="flex flex-col gap-1">
                  {r.steps.map((s, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <Badge tone={STEP_TONE[s.status]}>{STEP_LABEL[s.status]}</Badge>
                      <span>{t.actionTypes[s.action] ?? s.action}</span>
                      {s.note ? (
                        <span className="text-[var(--color-text-muted)]">{s.note}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {r.error ? <p className="mt-1 text-[var(--color-danger)]">{r.error}</p> : null}
              </Td>
            </Tr>
          ))}
        </DataTable>
      )}
      {runs.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button
            variant="secondary"
            loading={runs.isFetchingNextPage}
            onClick={() => void runs.fetchNextPage()}
          >
            {fa.common.more}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(PERMISSIONS.WORKFLOWS_WRITE);
  const catalog = useQuery({
    queryKey: ['workflow-catalog'],
    queryFn: () => api<WorkflowCatalogDto>('/workflows/catalog'),
  });
  const wf = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api<WorkflowDto>(`/workflows/${id}`),
  });

  const toggle = useMutation({
    mutationFn: (w: WorkflowDto) =>
      api<WorkflowDto>(`/workflows/${w.id}/${w.enabled ? 'disable' : 'enable'}`, {
        method: 'POST',
      }),
    onSuccess: async (w) => {
      toast(w.enabled ? t.enabledToast : t.disabledToast);
      qc.setQueryData(['workflow', id], w);
      await qc.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  if (wf.isLoading || catalog.isLoading) return <Skeleton />;
  if (wf.isError || !wf.data || catalog.isError || !catalog.data) {
    return (
      <ErrorBanner
        message={msg(wf.error ?? catalog.error)}
        onRetry={() => {
          void wf.refetch();
          void catalog.refetch();
        }}
      />
    );
  }
  const w = wf.data;
  return (
    <>
      <PageHeader
        title={w.name}
        actions={
          <div className="flex items-center gap-3">
            <Badge tone={w.enabled ? 'success' : 'neutral'}>
              {w.enabled ? t.enabled : t.disabled}
            </Badge>
            {canWrite ? (
              <Button
                variant="secondary"
                loading={toggle.isPending}
                onClick={() => toggle.mutate(w)}
              >
                {w.enabled ? t.disable : t.enable}
              </Button>
            ) : null}
            <Link href="/workflows" className="text-sm text-[var(--color-brand)] hover:underline">
              {t.title}
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <WorkflowForm
          key={w.updatedAt}
          workflow={w}
          catalog={catalog.data}
          readOnly={!canWrite}
          onSaved={async (saved) => {
            qc.setQueryData(['workflow', id], saved);
            await qc.invalidateQueries({ queryKey: ['workflows'] });
            toast(t.saved);
          }}
        />
        <Runs id={id} />
      </div>
    </>
  );
}
