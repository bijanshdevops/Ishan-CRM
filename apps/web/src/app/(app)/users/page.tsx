'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CreateUserRequestSchema, PERMISSIONS, type Page, type UserDto } from '@ishan/contracts';
import { fa, formatJalaliDateTime } from '@ishan/i18n';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Td,
  Tr,
  Card,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface RoleOption {
  id: string;
  key: string;
  name: string;
}

const msg = (e: unknown) => (e instanceof ApiClientError ? e.message : fa.common.error);

export default function UsersPage() {
  const { can, user: me } = useAuth();
  const canWrite = can(PERMISSIONS.USERS_WRITE);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserDto | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['users', search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<UserDto>>(
        `/users?limit=25${search ? `&q=${encodeURIComponent(search)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={fa.users.title}
        actions={
          canWrite ? <Button onClick={() => setEditing('new')}>{fa.users.add}</Button> : undefined
        }
      />
      <Card>
        <form
          role="search"
          className="mb-4 flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <div className="grow">
            <Input
              aria-label={fa.common.search}
              placeholder={fa.users.searchPlaceholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            {fa.common.search}
          </Button>
        </form>
        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.common.name,
              fa.common.email,
              fa.common.role,
              fa.common.status,
              fa.users.mfa,
              fa.common.lastLogin,
              ...(canWrite ? [fa.common.actions] : []),
            ]}
          >
            {items.map((u) => (
              <Tr key={u.id}>
                <Td>{u.name}</Td>
                <Td className="[direction:ltr] text-end">{u.email}</Td>
                <Td>{u.role.name}</Td>
                <Td>
                  <Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {u.status === 'ACTIVE' ? fa.common.active : fa.common.disabled}
                  </Badge>
                </Td>
                <Td>{u.mfaEnabled ? fa.common.yes : fa.common.no}</Td>
                <Td>{u.lastLoginAt ? formatJalaliDateTime(u.lastLoginAt) : '—'}</Td>
                {canWrite ? (
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setEditing(u)}>
                        {fa.common.edit}
                      </Button>
                      <Button variant="ghost" onClick={() => setResetting(u)}>
                        {fa.users.resetPassword}
                      </Button>
                    </div>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </DataTable>
        )}
        {list.hasNextPage ? (
          <div className="mt-4 text-center">
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
      {editing ? (
        <UserDialog target={editing} selfId={me?.id} onClose={() => setEditing(null)} />
      ) : null}
      {resetting ? <ResetDialog target={resetting} onClose={() => setResetting(null)} /> : null}
    </>
  );
}

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api<RoleOption[]>('/roles') });
}

function UserDialog({
  target,
  selfId,
  onClose,
}: {
  target: UserDto | 'new';
  selfId?: string;
  onClose: () => void;
}) {
  const isNew = target === 'new';
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoles();
  const [name, setName] = useState(isNew ? '' : target.name);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(isNew ? '' : target.role.id);
  const [status, setStatus] = useState<'ACTIVE' | 'DISABLED'>(isNew ? 'ACTIVE' : target.status);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const parsed = CreateUserRequestSchema.safeParse({
          email,
          name,
          roleId,
          password,
          mustChangePassword: true,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? fa.common.error);
        return api('/users', { method: 'POST', body: parsed.data });
      }
      return api(`/users/${target.id}`, { method: 'PATCH', body: { name, roleId, status } });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast(isNew ? fa.users.created : fa.users.updated);
      onClose();
    },
    onError: (e) =>
      setError(
        e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : fa.common.error,
      ),
  });

  return (
    <Modal title={isNew ? fa.users.createTitle : fa.users.editTitle} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={fa.common.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {isNew ? (
          <>
            <Field label={fa.common.email}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label={fa.users.temporaryPassword} hint={fa.users.temporaryHint}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  type="text"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}
        <Field label={fa.common.role}>
          {(p) => (
            <Select {...p} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">—</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!isNew ? (
          <Field label={fa.common.status}>
            {(p) => (
              <Select
                {...p}
                value={status}
                disabled={target.id === selfId}
                onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'DISABLED')}
              >
                <option value="ACTIVE">{fa.common.active}</option>
                <option value="DISABLED">{fa.common.disabled}</option>
              </Select>
            )}
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetDialog({ target, onClose }: { target: UserDto; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () =>
      api(`/users/${target.id}/reset-password`, {
        method: 'POST',
        body: { newPassword: password },
      }),
    onSuccess: () => {
      toast(fa.users.resetDone);
      onClose();
    },
    onError: (e) => setError(msg(e)),
  });
  return (
    <Modal title={`${fa.users.resetPassword}: ${target.name}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          reset.mutate();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={fa.users.temporaryPassword} hint={fa.users.temporaryHint}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button type="submit" loading={reset.isPending}>
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
