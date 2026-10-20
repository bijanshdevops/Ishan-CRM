import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/estedad';
import { fa } from '@ishan/i18n';
import { Providers } from '@/components/providers';
import './globals.css';

/** The CSP nonce is per request, so pages are rendered on demand rather than prerendered. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: `${fa.app.name} — ${fa.app.tagline}`, template: `%s | ${fa.app.name}` },
  description: fa.app.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
