export const dynamic = 'force-dynamic';

import { fa, formatJalaliDateLong } from '@ishan/i18n';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold" style={{ color: 'var(--color-brand)' }}>
        {fa.app.name}
      </h1>
      <p style={{ color: 'var(--color-text-muted)' }}>{fa.app.tagline}</p>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {formatJalaliDateLong(new Date())}
      </p>
    </main>
  );
}
