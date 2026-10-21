'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { ChangePasswordRequestSchema } from '@ishan/contracts';
import { fa, formatJalaliDateTime } from '@ishan/i18n';
import { NotificationEmailCard } from '@/components/notification-email-card';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

export default function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title={fa.account.title} />
      {user.mustChangePassword ? (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-warning)] p-3 text-sm"
        >
          {fa.account.mustChange}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <PasswordCard />
        {!user.mustChangePassword ? <MfaCard /> : null}
        {!user.mustChangePassword ? <NotificationEmailCard /> : null}
        {!user.mustChangePassword ? (
          <div className="lg:col-span-2">
            <SessionsCard />
          </div>
        ) : null}
      </div>
    </>
  );
}

function PasswordCard() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => {
      const parsed = ChangePasswordRequestSchema.safeParse({
        currentPassword: current,
        newPassword: next,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? fa.common.error);
      return api('/auth/change-password', { method: 'POST', body: parsed.data });
    },
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      toast(fa.account.changed);
      await refresh();
    },
    onError: (e) => setError(msg(e)),
  });
  return (
    <Card title={fa.account.passwordTitle}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          change.mutate();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={fa.account.current}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.account.next} hint={fa.account.nextHint}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" loading={change.isPending}>
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MfaCard() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 192 }).then(setQr);
  }, [setup]);

  const start = useMutation({
    mutationFn: () =>
      api<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', { method: 'POST' }),
    onSuccess: setSetup,
    onError: (e) => setError(msg(e)),
  });
  const enable = useMutation({
    mutationFn: () => api('/auth/mfa/enable', { method: 'POST', body: { code } }),
    onSuccess: async () => {
      setSetup(null);
      setCode('');
      toast(fa.account.mfaEnabled);
      await refresh();
    },
    onError: (e) => setError(msg(e)),
  });
  const disable = useMutation({
    mutationFn: () => api('/auth/mfa/disable', { method: 'POST', body: { password, code } }),
    onSuccess: async () => {
      setCode('');
      setPassword('');
      toast(fa.account.mfaDisabled);
      await refresh();
    },
    onError: (e) => setError(msg(e)),
  });

  return (
    <Card
      title={fa.account.mfaTitle}
      actions={
        <Badge tone={user?.mfaEnabled ? 'success' : 'neutral'}>
          {user?.mfaEnabled ? fa.account.mfaOn : fa.account.mfaOff}
        </Badge>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      {user?.mfaEnabled ? (
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            disable.mutate();
          }}
        >
          <Field label={fa.common.password}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Field label={fa.login.totpLabel}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="danger" loading={disable.isPending}>
              {fa.account.mfaDisable}
            </Button>
          </div>
        </form>
      ) : setup ? (
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            enable.mutate();
          }}
        >
          <p className="text-sm">{fa.account.mfaScan}</p>
          {qr ? (
            <img src={qr} alt="QR" width={192} height={192} className="rounded bg-white p-2" />
          ) : null}
          <code dir="ltr" className="break-all rounded bg-[var(--color-surface-2)] p-2 text-sm">
            {setup.secret}
          </code>
          <Field label={fa.login.totpLabel}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <div>
            <Button type="submit" loading={enable.isPending}>
              {fa.account.mfaConfirm}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3">
          <Button
            onClick={() => {
              setError(null);
              start.mutate();
            }}
            loading={start.isPending}
          >
            {fa.account.mfaStart}
          </Button>
        </div>
      )}
    </Card>
  );
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  current: boolean;
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionRow[]>('/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <Card title={fa.account.sessionsTitle}>
      {sessions.data ? (
        <DataTable head={[fa.account.device, fa.audit.ip, fa.audit.time, '']}>
          {sessions.data.map((s) => (
            <Tr key={s.id}>
              <Td className="max-w-64 truncate text-xs [direction:ltr] text-end">
                {s.userAgent ?? '—'}
              </Td>
              <Td className="[direction:ltr] text-end text-xs">{s.ip ?? '—'}</Td>
              <Td>{formatJalaliDateTime(s.lastSeenAt)}</Td>
              <Td>
                {s.current ? (
                  <Badge tone="brand">{fa.account.current_session}</Badge>
                ) : (
                  <Button variant="ghost" onClick={() => revoke.mutate(s.id)}>
                    {fa.account.revoke}
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
