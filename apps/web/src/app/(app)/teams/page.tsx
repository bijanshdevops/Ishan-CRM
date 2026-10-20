'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS } from '@ishan/contracts';
import { fa, formatNumber } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

export default function TeamsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<TeamRow[]>('/teams') });
  const create = useMutation({
    mutationFn: () =>
      api('/teams', { method: 'POST', body: { name, ...(description ? { description } : {}) } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['teams'] });
      toast(fa.teams.created);
      setOpen(false);
      setName('');
      setDescription('');
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : fa.common.error),
  });

  return (
    <>
      <PageHeader
        title={fa.teams.title}
        actions={
          can(PERMISSIONS.TEAMS_WRITE) ? (
            <Button onClick={() => setOpen(true)}>{fa.teams.add}</Button>
          ) : undefined
        }
      />
      <Card>
        {teams.isLoading ? (
          <Skeleton />
        ) : teams.isError ? (
          <ErrorBanner message={fa.common.error} onRetry={() => void teams.refetch()} />
        ) : teams.data?.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable head={[fa.common.name, fa.common.description, fa.teams.memberCount]}>
            {teams.data?.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Link
                    className="font-medium text-[var(--color-brand)] underline-offset-4 hover:underline"
                    href={`/teams/${t.id}`}
                  >
                    {t.name}
                  </Link>
                </Td>
                <Td>{t.description ?? '—'}</Td>
                <Td>{formatNumber(t.memberCount)}</Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </Card>
      {open ? (
        <Modal title={fa.teams.add} onClose={() => setOpen(false)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              create.mutate();
            }}
          >
            {error ? <ErrorBanner message={error} /> : null}
            <Field label={fa.common.name}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label={fa.common.description}>
              {(p) => (
                <Input
                  {...p}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {fa.common.cancel}
              </Button>
              <Button type="submit" loading={create.isPending}>
                {fa.common.create}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
