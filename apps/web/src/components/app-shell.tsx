'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PERMISSIONS } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { useAuth } from '@/lib/auth';
import { IS_DEMO } from '@/lib/base-path';
import { Logo } from './logo';
import { ReminderBell } from './reminder-bell';
import { Button, Skeleton } from './ui';

const NAV = [
  { href: '/', label: fa.nav.home, permission: null },
  { href: '/customers', label: fa.nav.customers, permission: PERMISSIONS.CUSTOMERS_READ },
  { href: '/leads', label: fa.nav.leads, permission: PERMISSIONS.LEADS_READ },
  { href: '/campaigns', label: fa.nav.campaigns, permission: PERMISSIONS.CAMPAIGNS_READ },
  { href: '/deals', label: fa.nav.deals, permission: PERMISSIONS.DEALS_READ },
  { href: '/products', label: fa.nav.products, permission: PERMISSIONS.PRODUCTS_READ },
  { href: '/quotes', label: fa.nav.quotes, permission: PERMISSIONS.QUOTES_READ },
  { href: '/contracts', label: fa.nav.contracts, permission: PERMISSIONS.CONTRACTS_READ },
  { href: '/activities', label: fa.nav.activities, permission: PERMISSIONS.ACTIVITIES_READ },
  { href: '/calendar', label: fa.nav.calendar, permission: PERMISSIONS.ACTIVITIES_READ },
  { href: '/workflows', label: fa.nav.workflows, permission: PERMISSIONS.WORKFLOWS_READ },
  { href: '/webhooks', label: fa.nav.webhooks, permission: PERMISSIONS.WEBHOOKS_READ },
  { href: '/users', label: fa.nav.users, permission: PERMISSIONS.USERS_READ },
  { href: '/teams', label: fa.nav.teams, permission: PERMISSIONS.TEAMS_READ },
  { href: '/roles', label: fa.nav.roles, permission: PERMISSIONS.ROLES_READ },
  { href: '/audit', label: fa.nav.audit, permission: PERMISSIONS.AUDIT_READ },
  { href: '/account', label: fa.nav.account, permission: null },
] as const;

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('theme');
      const initial =
        saved === 'dark' || saved === 'light'
          ? saved
          : matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
      setTheme(initial);
      document.documentElement.dataset.theme = initial;
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* ignore */
    }
  };
  return { theme, toggle };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, can, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.mustChangePassword && pathname !== '/account') router.replace('/account');
  }, [loading, user, pathname, router]);

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Skeleton rows={4} />
      </div>
    );
  }

  const items = NAV.filter((n) => !n.permission || can(n.permission));
  return (
    <div
      className={`min-h-dvh md:grid md:grid-cols-[16rem_1fr] print:block ${
        IS_DEMO ? 'md:grid-rows-[auto_1fr]' : ''
      }`}
    >
      {IS_DEMO ? (
        <p
          role="note"
          className="print:hidden bg-[var(--color-brand)] px-4 py-2 text-center text-sm text-[var(--color-brand-contrast)] md:col-span-2"
        >
          {fa.demo.banner}
        </p>
      ) : null}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-[var(--color-surface)] focus:p-3"
      >
        {fa.nav.skip}
      </a>
      <aside className="print:hidden border-b border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:border-b-0 md:border-e">
        <div className="mb-4 flex items-center justify-between md:mb-6">
          <span className="flex items-center gap-2 text-xl font-bold text-[var(--color-brand)]">
            <Logo size={28} />
            {fa.app.name}
          </span>
          <div className="flex items-center">
            <ReminderBell />
            <Button variant="ghost" onClick={toggle} aria-label={fa.nav.theme}>
              {theme === 'dark' ? '☀' : '☾'}
            </Button>
          </div>
        </div>
        <nav aria-label="ناوبری اصلی" className="flex gap-1 overflow-x-auto md:flex-col">
          {items.map((n) => {
            const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-sm ${
                  active
                    ? 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)]'
                    : 'hover:bg-[var(--color-surface-2)]'
                } focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 hidden border-t border-[var(--color-border)] pt-4 text-sm md:block">
          <p className="font-medium">{user.name}</p>
          <p className="mb-3 text-[var(--color-text-muted)]">{user.role.name}</p>
          <Button variant="secondary" className="w-full" onClick={() => void logout()}>
            {fa.nav.logout}
          </Button>
        </div>
      </aside>
      <main id="main" className="p-4 md:p-8 print:p-0">
        {children}
        <div className="mt-8 md:hidden">
          <Button variant="secondary" onClick={() => void logout()}>
            {fa.nav.logout}
          </Button>
        </div>
      </main>
    </div>
  );
}
