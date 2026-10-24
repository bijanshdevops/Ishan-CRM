'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fa } from '@ishan/i18n';
import { Logo } from '@/components/logo';
import { Button, Card, ErrorBanner } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';

const t = fa.verifyEmail;

/**
 * Public page opened from the e-mail link. The token is only spent by the button (a POST), never by
 * opening the page, so mail scanners and link previews cannot consume it (ADR 0014).
 */
export default function VerifyEmailPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    setToken(value);
    setReady(true);
    // keep the one-time token out of the address bar and the browser history
    if (value) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/verify-email', { method: 'POST', body: { token } });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiClientError && e.status === 400 ? t.invalid : fa.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={64} />
        <h1 className="text-3xl font-bold text-[var(--color-brand)]">{fa.app.name}</h1>
      </div>
      <Card title={t.title}>
        {!ready ? null : done ? (
          <div className="mt-3 flex flex-col gap-4">
            <p role="status" className="text-sm">
              {t.done}
            </p>
            <Link href="/account" className="text-sm text-[var(--color-brand)] underline">
              {t.toAccount}
            </Link>
          </div>
        ) : !token ? (
          <ErrorBanner message={t.missing} />
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {error ? <ErrorBanner message={error} /> : null}
            <p className="text-sm">{t.intro}</p>
            <div>
              <Button onClick={confirm} loading={busy}>
                {t.confirm}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}
