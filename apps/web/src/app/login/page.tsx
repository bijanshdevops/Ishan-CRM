'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { LoginRequestSchema } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { Button, Card, ErrorBanner, Field, Input } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { IS_DEMO, withBase } from '@/lib/base-path';

/** The public demo has no sign-in form: visitors enter as the restricted demo user. */
function DemoEntry() {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api('/demo/session', { method: 'POST' })
      .then(() => {
        if (!cancelled) window.location.assign(withBase('/'));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold text-[var(--color-brand)]">{fa.app.name}</h1>
      {failed ? (
        <>
          <ErrorBanner message={fa.demo.failed} />
          <Button onClick={() => setAttempt((n) => n + 1)}>{fa.demo.retry}</Button>
        </>
      ) : (
        <p role="status" className="text-[var(--color-text-muted)]">
          {fa.demo.entering}
        </p>
      )}
    </main>
  );
}

export default function LoginPage() {
  return IS_DEMO ? <DemoEntry /> : <SignInForm />;
}

function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = LoginRequestSchema.safeParse({
      email,
      password,
      ...(needsTotp ? { totpCode: totp } : {}),
    });
    if (!parsed.success) {
      setError(needsTotp ? fa.login.totpHint : fa.login.invalid);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ status: 'ok' | 'mfa_required' }>('/auth/login', {
        method: 'POST',
        body: parsed.data,
      });
      if (res.status === 'mfa_required') setNeedsTotp(true);
      else window.location.assign(withBase('/'));
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.status === 429 ? fa.login.tooMany : fa.login.invalid,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-[var(--color-brand)]">{fa.app.name}</h1>
        <p className="text-[var(--color-text-muted)]">{fa.app.tagline}</p>
      </div>
      <Card title={needsTotp ? fa.login.totpTitle : fa.login.title}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error ? <ErrorBanner message={error} /> : null}
          {needsTotp ? (
            <Field label={fa.login.totpLabel} hint={fa.login.totpHint}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
          ) : (
            <>
              <Field label={fa.common.email}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                )}
              </Field>
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
            </>
          )}
          <Button type="submit" loading={busy}>
            {fa.login.submit}
          </Button>
        </form>
      </Card>
    </main>
  );
}
