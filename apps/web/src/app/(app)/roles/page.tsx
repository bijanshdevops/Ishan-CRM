'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreateRoleRequestSchema,
  DATA_SCOPES,
  PERMISSIONS,
  type DataScope,
} from '@ishan/contracts';
import { PERMISSION_LABELS, fa, formatNumber } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  dataScope: DataScope;
  userCount: number;
  updatedAt: string;
}

const SCOPE_LABELS: Record<DataScope, string> = {
  ALL: fa.roles.scopeAll,
  TEAM: fa.roles.scopeTeam,
  OWN: fa.roles.scopeOwn,
};

export default function RolesPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.ROLES_WRITE);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [dataScope, setDataScope] = useState<DataScope>('TEAM');

  const roles = useQuery({ queryKey: ['roles', 'full'], queryFn: () => api<RoleRow[]>('/roles') });
  const catalog = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api<{ permissions: string[] }>('/roles/permissions'),
  });

  const create = useMutation({
    mutationFn: () => {
      const parsed = CreateRoleRequestSchema.safeParse({
        key,
        name,
        permissions: selected,
        dataScope,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? fa.common.error);
      return api('/roles', { method: 'POST', body: parsed.data });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['roles'] });
      toast(fa.roles.created);
      setOpen(false);
      setKey('');
      setName('');
      setSelected([]);
      setDataScope('TEAM');
    },
    onError: (e) =>
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error),
  });
  const changeScope = useMutation({
    mutationFn: (v: { id: string; dataScope: DataScope; version: string }) =>
      api(`/roles/${v.id}`, {
        method: 'PATCH',
        body: { dataScope: v.dataScope },
        version: v.version,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['roles'] });
      toast(fa.roles.scopeSaved);
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : fa.common.error, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : fa.common.error, 'error'),
  });

  return (
    <>
      <PageHeader
        title={fa.roles.title}
        actions={
          canWrite ? <Button onClick={() => setOpen(true)}>{fa.roles.add}</Button> : undefined
        }
      />
      {roles.isLoading ? (
        <Skeleton />
      ) : roles.isError ? (
        <ErrorBanner message={fa.common.error} onRetry={() => void roles.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.data?.map((r) => (
            <Card
              key={r.id}
              title={r.name}
              actions={
                <div className="flex items-center gap-2">
                  {r.isSystem ? <Badge tone="brand">{fa.roles.system}</Badge> : null}
                  {canWrite && !r.isSystem ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(fa.roles.deleteConfirm)) remove.mutate(r.id);
                      }}
                    >
                      {fa.common.delete}
                    </Button>
                  ) : null}
                </div>
              }
            >
              {r.description ? (
                <p className="mb-3 text-sm text-[var(--color-text-muted)]">{r.description}</p>
              ) : null}
              <ul className="mb-3 flex flex-wrap gap-2">
                {r.permissions.length ? (
                  r.permissions.map((p) => (
                    <li key={p}>
                      <Badge>{PERMISSION_LABELS[p] ?? p}</Badge>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-[var(--color-text-muted)]">{fa.home.noAccess}</li>
                )}
              </ul>
              {canWrite && r.key !== 'admin' ? (
                <div className="mb-3">
                  <Field label={fa.roles.scope}>
                    {(p) => (
                      <Select
                        {...p}
                        value={r.dataScope}
                        disabled={changeScope.isPending}
                        onChange={(e) =>
                          changeScope.mutate({
                            id: r.id,
                            dataScope: e.target.value as DataScope,
                            version: r.updatedAt,
                          })
                        }
                      >
                        {DATA_SCOPES.map((s) => (
                          <option key={s} value={s}>
                            {SCOPE_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              ) : (
                <p className="mb-3 text-sm">
                  {fa.roles.scope}: {SCOPE_LABELS[r.dataScope]}
                  {r.key === 'admin' ? (
                    <span className="block text-[var(--color-text-muted)]">
                      {fa.roles.scopeAdminLocked}
                    </span>
                  ) : null}
                </p>
              )}
              <p className="text-sm text-[var(--color-text-muted)]">
                {fa.roles.users}: {formatNumber(r.userCount)}
              </p>
            </Card>
          ))}
        </div>
      )}
      {open ? (
        <Modal title={fa.roles.add} onClose={() => setOpen(false)}>
          <form
            className="flex flex-col gap-4"
            noValidate
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
            <Field label={fa.roles.key} hint={fa.roles.keyHint}>
              {(p) => (
                <Input {...p} dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} />
              )}
            </Field>
            <Field label={fa.roles.scope} hint={fa.roles.scopeHint}>
              {(p) => (
                <Select
                  {...p}
                  value={dataScope}
                  onChange={(e) => setDataScope(e.target.value as DataScope)}
                >
                  {DATA_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{fa.roles.permissions}</legend>
              {catalog.data?.permissions.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(p)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, p] : s.filter((x) => x !== p)))
                    }
                  />
                  {PERMISSION_LABELS[p] ?? p}
                </label>
              ))}
            </fieldset>
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
