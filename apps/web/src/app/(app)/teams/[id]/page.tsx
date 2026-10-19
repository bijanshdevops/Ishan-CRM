'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type Page, type UserDto } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Select,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface TeamDetail {
  id: string;
  name: string;
  description: string | null;
  members: Array<{ userId: string; name: string; email: string; role: 'MEMBER' | 'LEAD' }>;
}

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.TEAMS_WRITE);
  const qc = useQueryClient();
  const toast = useToast();
  const team = useQuery({ queryKey: ['team', id], queryFn: () => api<TeamDetail>(`/teams/${id}`) });
  const candidates = useQuery({
    queryKey: ['users', 'all'],
    enabled: canWrite && can(PERMISSIONS.USERS_READ),
    queryFn: () => api<Page<UserDto>>('/users?limit=100'),
  });
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'LEAD'>('MEMBER');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['team', id] });
  const fail = (e: unknown) => setError(e instanceof ApiClientError ? e.message : fa.common.error);
  const add = useMutation({
    mutationFn: () => api(`/teams/${id}/members`, { method: 'PUT', body: { userId, role } }),
    onSuccess: async () => {
      setUserId('');
      await refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (uid: string) => api(`/teams/${id}/members/${uid}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: fail,
  });
  const del = useMutation({
    mutationFn: () => api(`/teams/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['teams'] });
      toast(fa.common.delete);
      router.replace('/teams');
    },
    onError: fail,
  });

  if (team.isLoading) return <Skeleton />;
  if (team.isError || !team.data)
    return <ErrorBanner message={fa.common.error} onRetry={() => void team.refetch()} />;
  const memberIds = new Set(team.data.members.map((m) => m.userId));

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/teams" className="text-[var(--color-brand)] hover:underline">
          ← {fa.teams.back}
        </Link>
      </p>
      <PageHeader
        title={team.data.name}
        actions={
          canWrite ? (
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(fa.teams.deleteConfirm)) del.mutate();
              }}
            >
              {fa.common.delete}
            </Button>
          ) : undefined
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      <Card title={fa.teams.members}>
        {team.data.members.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.common.name,
              fa.common.email,
              fa.common.role,
              ...(canWrite ? [fa.common.actions] : []),
            ]}
          >
            {team.data.members.map((m) => (
              <Tr key={m.userId}>
                <Td>{m.name}</Td>
                <Td className="[direction:ltr] text-end">{m.email}</Td>
                <Td>
                  <Badge tone={m.role === 'LEAD' ? 'brand' : 'neutral'}>
                    {m.role === 'LEAD' ? fa.teams.lead : fa.teams.member}
                  </Badge>
                </Td>
                {canWrite ? (
                  <Td>
                    <Button variant="ghost" onClick={() => remove.mutate(m.userId)}>
                      {fa.common.delete}
                    </Button>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </DataTable>
        )}
        {canWrite && candidates.data ? (
          <form
            className="mt-6 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (userId) add.mutate();
            }}
          >
            <div className="min-w-48 grow">
              <Field label={fa.teams.addMember}>
                {(p) => (
                  <Select {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
                    <option value="">—</option>
                    {candidates.data.items
                      .filter((u) => u.status === 'ACTIVE' && !memberIds.has(u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field label={fa.common.role}>
              {(p) => (
                <Select
                  {...p}
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'MEMBER' | 'LEAD')}
                >
                  <option value="MEMBER">{fa.teams.member}</option>
                  <option value="LEAD">{fa.teams.lead}</option>
                </Select>
              )}
            </Field>
            <Button type="submit" loading={add.isPending} disabled={!userId}>
              {fa.teams.addMember}
            </Button>
          </form>
        ) : null}
      </Card>
    </>
  );
}
