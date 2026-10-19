import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/vazirmatn';
import { fa } from '@ishan/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${fa.app.name} — ${fa.app.tagline}`, template: `%s | ${fa.app.name}` },
  description: fa.app.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
