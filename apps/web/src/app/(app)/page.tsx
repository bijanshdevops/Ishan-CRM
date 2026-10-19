'use client';

import { PERMISSION_LABELS, fa, formatJalaliDateTime } from '@ishan/i18n';
import { Badge, Card, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title={`${fa.home.welcome}، ${user.name}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={fa.home.yourRole}>
          <p className="text-lg font-medium">{user.role.name}</p>
          {user.lastLoginAt ? (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {fa.common.lastLogin}: {formatJalaliDateTime(user.lastLoginAt)}
            </p>
          ) : null}
        </Card>
        <Card title={fa.home.yourAccess}>
          {user.permissions.length ? (
            <ul className="flex flex-wrap gap-2">
              {user.permissions.map((p) => (
                <li key={p}>
                  <Badge tone="brand">{PERMISSION_LABELS[p] ?? p}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--color-text-muted)]">{fa.home.noAccess}</p>
          )}
        </Card>
      </div>
    </>
  );
}
