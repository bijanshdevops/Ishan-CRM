'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type WorkflowCatalogDto } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import { WorkflowForm } from '@/components/workflow-form';
import { ErrorBanner, PageHeader, Skeleton } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function NewWorkflowPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const catalog = useQuery({
    queryKey: ['workflow-catalog'],
    queryFn: () => api<WorkflowCatalogDto>('/workflows/catalog'),
  });

  return (
    <>
      <PageHeader title={fa.workflows.addTitle} />
      {!can(PERMISSIONS.WORKFLOWS_WRITE) ? (
        <ErrorBanner message={fa.common.error} />
      ) : catalog.isLoading ? (
        <Skeleton />
      ) : catalog.isError || !catalog.data ? (
        <ErrorBanner
          message={
            catalog.error instanceof ApiClientError ? catalog.error.message : fa.common.error
          }
          onRetry={() => void catalog.refetch()}
        />
      ) : (
        <WorkflowForm
          catalog={catalog.data}
          onSaved={async (w) => {
            await qc.invalidateQueries({ queryKey: ['workflows'] });
            toast(fa.workflows.created);
            router.push(`/workflows/${w.id}`);
          }}
        />
      )}
    </>
  );
}
