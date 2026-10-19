'use client';

import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type ActivityDto } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { api, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ActivityFormDialog } from './activity-form';
import {
  ActivityIcon,
  ActivityStatusBadge,
  activityWhen,
  useRefreshActivities,
} from './activity-bits';
import { useToast } from './toast';
import { Badge, Button, Field, Modal, Textarea } from './ui';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

/** Mirrors the server rule so we only offer actions that can succeed (the server still enforces it). */
export function useCanModify() {
  const { user, can } = useAuth();
  return (a: Pick<ActivityDto, 'assignee' | 'createdBy'>) =>
    can(PERMISSIONS.ACTIVITIES_WRITE) &&
    (can(PERMISSIONS.ACTIVITIES_MANAGE_ALL) ||
      a.assignee?.id === user?.id ||
      a.createdBy?.id === user?.id);
}

export function ActivityItem({
  a,
  showCustomer = true,
}: {
  a: ActivityDto;
  showCustomer?: boolean;
}) {
  const { can } = useAuth();
  const canModify = useCanModify();
  const toast = useToast();
  const refresh = useRefreshActivities();
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Toast in the hook-level callback: the row unmounts once the lists refresh, and
  // per-call mutate callbacks are dropped for unmounted components.
  const act = useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      ok: string;
      method?: string;
      body?: unknown;
    }) => api(`/activities/${a.id}${path}`, { method, body }),
    onSuccess: async (_d, v) => {
      toast(v.ok);
      await refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const run = (path: string, ok: string, method?: string, body?: unknown) =>
    act.mutate({ path, ok, method, body });

  const mine = canModify(a);
  const planned = a.status === 'PLANNED';
  const reopenable = a.type !== 'NOTE' && a.status !== 'PLANNED' && !!a.dueAt;

  return (
    <li className="flex flex-col gap-2 border-b border-[var(--color-border)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`mt-0.5 rounded-full p-1.5 ${
            a.overdue
              ? 'bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)] text-[var(--color-danger)]'
              : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
          }`}
        >
          <ActivityIcon type={a.type} />
          <span className="sr-only">{fa.activities.types[a.type]}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${a.status === 'CANCELED' ? 'line-through opacity-60' : ''}`}>
            {a.type === 'NOTE' ? (a.description ?? a.title) : a.title}
          </p>
          {a.type !== 'NOTE' && a.description ? (
            <p className="whitespace-pre-line text-sm text-[var(--color-text-muted)]">
              {a.description}
            </p>
          ) : null}
          {a.outcome ? (
            <p className="text-sm">
              <span className="text-[var(--color-text-muted)]">{fa.activities.outcome}: </span>
              {a.outcome}
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span>{activityWhen(a)}</span>
            {showCustomer && a.customer && can(PERMISSIONS.CUSTOMERS_READ) ? (
              <Link
                href={`/customers/${a.customer.id}`}
                className="text-[var(--color-brand)] hover:underline"
              >
                {a.customer.name}
              </Link>
            ) : null}
            {a.contact ? <span>{a.contact.name}</span> : null}
            {a.deal ? <span>{a.deal.title}</span> : null}
            {a.assignee ? <span>{a.assignee.name}</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {a.priority === 'HIGH' && planned ? (
            <Badge tone="danger">{fa.activities.priorities.HIGH}</Badge>
          ) : null}
          {a.type !== 'NOTE' ? <ActivityStatusBadge a={a} /> : null}
        </div>
      </div>
      {mine ? (
        <div className="flex flex-wrap gap-1 ps-11">
          {planned ? (
            <Button
              variant="secondary"
              className="min-h-8 px-3"
              loading={act.isPending}
              onClick={() => {
                if (a.type === 'CALL' || a.type === 'MEETING') setCompleting(true);
                else run('/complete', fa.activities.completed, 'POST', {});
              }}
            >
              {fa.activities.complete}
            </Button>
          ) : null}
          {reopenable ? (
            <Button
              variant="ghost"
              className="min-h-8 px-3"
              disabled={act.isPending}
              onClick={() => run('/reopen', fa.activities.reopened)}
            >
              {fa.activities.reopen}
            </Button>
          ) : null}
          <Button variant="ghost" className="min-h-8 px-3" onClick={() => setEditing(true)}>
            {fa.common.edit}
          </Button>
          {planned ? (
            <Button
              variant="ghost"
              className="min-h-8 px-3"
              disabled={act.isPending}
              onClick={() => {
                if (window.confirm(fa.activities.cancelConfirm))
                  run('/cancel', fa.activities.canceled);
              }}
            >
              {fa.activities.cancel}
            </Button>
          ) : null}
          {can(PERMISSIONS.ACTIVITIES_DELETE) ? (
            <Button
              variant="ghost"
              className="min-h-8 px-3"
              disabled={act.isPending}
              onClick={() => {
                if (window.confirm(fa.activities.deleteConfirm))
                  run('', fa.activities.deleted, 'DELETE');
              }}
            >
              {fa.common.delete}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing ? <ActivityFormDialog activity={a} onClose={() => setEditing(false)} /> : null}
      {completing ? (
        <CompleteDialog
          onClose={() => setCompleting(false)}
          onConfirm={(outcome) => {
            setCompleting(false);
            run('/complete', fa.activities.completed, 'POST', outcome ? { outcome } : {});
          }}
        />
      ) : null}
    </li>
  );
}

function CompleteDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (outcome: string) => void;
}) {
  const [outcome, setOutcome] = useState('');
  return (
    <Modal title={fa.activities.complete} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(outcome.trim());
        }}
      >
        <Field label={fa.activities.outcome}>
          {(p) => (
            <Textarea
              {...p}
              placeholder={fa.activities.outcomePlaceholder}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button type="submit">{fa.activities.complete}</Button>
        </div>
      </form>
    </Modal>
  );
}
