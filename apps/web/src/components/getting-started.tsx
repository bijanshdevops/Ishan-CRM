'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DashboardDto } from '@ishan/contracts';
import { fa, formatNumber } from '@ishan/i18n';
import { useAuth } from '@/lib/auth';
import { dismissCard, isCardDismissed } from '@/lib/tour';
import { useTour } from './tour';
import { Badge, Button, Card } from './ui';

interface Item {
  key: 'customer' | 'lead' | 'deal';
  href: string;
  done: boolean;
}

/**
 * Onboarding card for the dashboard. Progress comes from real data (never faked): a step is
 * "done" once the organisation has at least one such record, and steps the user cannot see
 * (the dashboard section is null without the read permission) are left out.
 */
export function GettingStarted({ data }: { data: DashboardDto }) {
  const { user } = useAuth();
  const { start, memory } = useTour();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    setDismissed(user ? isCardDismissed(user.id) : true);
  }, [user]);

  if (!user || dismissed) return null;
  const t = fa.tour.gettingStarted;

  const items: Item[] = [];
  if (data.customers) {
    items.push({ key: 'customer', href: '/customers', done: data.customers.total > 0 });
  }
  if (data.leads) {
    const n = Object.values(data.leads.byStatus).reduce((a, b) => a + b, 0);
    items.push({ key: 'lead', href: '/leads', done: n > 0 });
  }
  if (data.deals) {
    const n = data.deals.openCount + data.deals.wonCount + data.deals.lostCount;
    items.push({ key: 'deal', href: '/deals', done: n > 0 });
  }
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div data-testid="getting-started">
      <Card
        title={t.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={start}>{memory ? t.restartTour : t.startTour}</Button>
            <Button
              variant="ghost"
              onClick={() => {
                dismissCard(user.id);
                setDismissed(true);
              }}
            >
              {t.dismiss}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">{t.intro}</p>
        {items.length > 0 ? (
          <>
            <p className="mb-2 text-sm font-medium">
              {t.progress}: {formatNumber(doneCount)} {fa.tour.of} {formatNumber(items.length)}
            </p>
            <ul className="flex flex-col gap-2">
              {items.map((i) => (
                <li
                  key={i.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone={i.done ? 'success' : 'neutral'}>{i.done ? t.done : t.todo}</Badge>
                    {t[i.key]}
                  </span>
                  <Link
                    href={i.href}
                    className="text-[var(--color-brand)] underline focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                  >
                    {t.open}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    </div>
  );
}
