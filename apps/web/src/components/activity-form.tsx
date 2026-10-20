'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreateActivityRequestSchema,
  PERMISSIONS,
  type ActivityDto,
  type ActivityType,
  type CustomerDetailDto,
  type DealDto,
  type Page,
  type UserDto,
} from '@ishan/contracts';
import { fa, formatJalaliDateTime, instantToJalali, jalaliToInstant } from '@ishan/i18n';
import { api, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRefreshActivities } from './activity-bits';
import { CustomerPicker } from './customer-picker';
import { JalaliDateTimeField } from './jalali-date-time';
import { useToast } from './toast';
import { Button, ErrorBanner, Field, Input, Modal, Select, Textarea } from './ui';

export interface ActivityDefaults {
  type?: ActivityType;
  customer?: { id: string; name: string };
  contactId?: string;
  dealId?: string;
  /** Open in "already happened" mode (log a past call/meeting). */
  logPast?: boolean;
}

const REMIND_OFFSETS = ['0', '15', '60', '1440'] as const;
const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

/** Next full hour in Tehran time, as a UTC instant. */
function nextHour(): string {
  const p = instantToJalali(new Date());
  return jalaliToInstant({ ...p, hour: p.hour + 1, minute: 0 }).toISOString();
}

function offsetOf(a: ActivityDto | undefined): string {
  if (!a?.remindAt) return '';
  if (!a.dueAt) return 'keep';
  const diff = Math.round((Date.parse(a.dueAt) - Date.parse(a.remindAt)) / 60_000);
  return (REMIND_OFFSETS as readonly string[]).includes(String(diff)) ? String(diff) : 'keep';
}

export function ActivityFormDialog({
  activity,
  defaults,
  onClose,
  onSaved,
}: {
  activity?: ActivityDto;
  defaults?: ActivityDefaults;
  onClose: () => void;
  onSaved?: (a: ActivityDto) => void;
}) {
  const { user, can } = useAuth();
  const toast = useToast();
  const refresh = useRefreshActivities();
  const editing = !!activity;
  const lockedCustomer = !editing && defaults?.customer ? defaults.customer : undefined;

  const [f, setF] = useState({
    type: (activity?.type ?? defaults?.type ?? 'TASK') as ActivityType,
    title: activity?.title ?? '',
    description: activity?.description ?? '',
    dueAt: activity ? (activity.dueAt ?? '') : nextHour(),
    endAt: activity?.endAt ?? '',
    remindOffset: offsetOf(activity),
    priority: activity?.priority ?? 'NORMAL',
    assigneeId: editing ? (activity.assignee?.id ?? '') : (user?.id ?? ''),
    customerId: activity?.customer?.id ?? defaults?.customer?.id ?? '',
    contactId: activity?.contact?.id ?? defaults?.contactId ?? '',
    dealId: activity?.deal?.id ?? defaults?.dealId ?? '',
    logPast: defaults?.logPast ?? false,
    happenedAt: new Date().toISOString(),
    outcome: activity?.outcome ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const isNote = f.type === 'NOTE';
  const isPlannedEdit = editing && activity.status === 'PLANNED';
  const showSchedule = !isNote && (editing ? isPlannedEdit : !f.logPast);
  const showOutcome =
    !isNote &&
    (f.type === 'CALL' || f.type === 'MEETING') &&
    (editing ? activity.status === 'DONE' : f.logPast);

  const users = useQuery({
    queryKey: ['users', 'owners'],
    enabled: can(PERMISSIONS.USERS_READ),
    queryFn: () => api<Page<UserDto>>('/users?limit=100'),
  });
  const customer = useQuery({
    queryKey: ['customer', f.customerId],
    enabled: !!f.customerId,
    queryFn: () => api<CustomerDetailDto>(`/customers/${f.customerId}`),
  });
  const deals = useQuery({
    queryKey: ['deals', 'byCustomer', f.customerId],
    enabled: !!f.customerId && can(PERMISSIONS.DEALS_READ),
    queryFn: () => api<Page<DealDto>>(`/deals?customerId=${f.customerId}&limit=50`),
  });

  const remindAt = (): string | undefined => {
    if (!f.remindOffset || !f.dueAt) return undefined;
    if (f.remindOffset === 'keep') return activity?.remindAt ?? undefined;
    return new Date(Date.parse(f.dueAt) - Number(f.remindOffset) * 60_000).toISOString();
  };

  const save = useMutation({
    mutationFn: async () => {
      const links = {
        customerId: f.customerId || null,
        contactId: f.contactId || null,
        dealId: f.dealId || null,
      };
      if (editing) {
        const body: Record<string, unknown> = {
          description: f.description || null,
          assigneeId: f.assigneeId || null,
          ...links,
        };
        if (!isNote) {
          body.title = f.title;
          body.priority = f.priority;
          if (isPlannedEdit) {
            if (!f.dueAt) throw new Error(fa.activities.dateRequired);
            body.dueAt = f.dueAt;
            body.endAt = f.endAt || null;
            body.remindAt = remindAt() ?? null;
          }
          if (showOutcome) body.outcome = f.outcome || null;
        }
        return api<ActivityDto>(`/activities/${activity.id}`, { method: 'PATCH', body });
      }
      const candidate = {
        type: f.type,
        ...(isNote ? {} : { title: f.title }),
        description: f.description || undefined,
        assigneeId: isNote ? undefined : f.assigneeId || undefined,
        customerId: links.customerId,
        contactId: links.contactId,
        dealId: links.dealId,
        ...(isNote
          ? {}
          : f.logPast
            ? {
                status: 'DONE' as const,
                completedAt: f.happenedAt || undefined,
                outcome: f.outcome || undefined,
              }
            : {
                dueAt: f.dueAt || undefined,
                endAt: f.endAt || undefined,
                remindAt: remindAt(),
                priority: f.priority,
              }),
      };
      const parsed = CreateActivityRequestSchema.safeParse(candidate);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? fa.common.error);
      return api<ActivityDto>('/activities', { method: 'POST', body: parsed.data });
    },
    onSuccess: async (a) => {
      toast(editing ? fa.activities.updated : fa.activities.created);
      onSaved?.(a);
      onClose();
      await refresh();
    },
    onError: (e) => setError(msg(e)),
  });

  const title = editing ? fa.activities.edit : fa.activities.add;
  return (
    <Modal title={title} onClose={onClose}>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {error ? (
          <div className="sm:col-span-2">
            <ErrorBanner message={error} />
          </div>
        ) : null}

        {!editing ? (
          <Field label={fa.activities.type}>
            {(p) => (
              <Select
                {...p}
                value={f.type}
                onChange={(e) => set('type', e.target.value as ActivityType)}
              >
                {Object.entries(fa.activities.types).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {!isNote ? (
          <div className={editing ? 'sm:col-span-2' : undefined}>
            <Field label={fa.activities.activityTitle}>
              {(p) => (
                <Input {...p} value={f.title} onChange={(e) => set('title', e.target.value)} />
              )}
            </Field>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <Field label={isNote ? fa.activities.noteText : fa.activities.description}>
            {(p) => (
              <Textarea
                {...p}
                value={f.description}
                onChange={(e) => set('description', e.target.value)}
              />
            )}
          </Field>
        </div>

        {!isNote && !editing ? (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={f.logPast}
              onChange={(e) => set('logPast', e.target.checked)}
            />
            {fa.activities.logPast}
          </label>
        ) : null}

        {showSchedule ? (
          <>
            <div className="sm:col-span-2">
              <JalaliDateTimeField
                label={f.type === 'TASK' ? fa.activities.dueAt : fa.activities.startAt}
                value={f.dueAt}
                onChange={(v) => set('dueAt', v)}
              />
            </div>
            {f.type !== 'TASK' ? (
              <div className="sm:col-span-2">
                <JalaliDateTimeField
                  label={fa.activities.endAt}
                  value={f.endAt}
                  onChange={(v) => set('endAt', v)}
                  optional
                />
              </div>
            ) : null}
            <Field label={fa.activities.remindAt}>
              {(p) => (
                <Select
                  {...p}
                  value={f.remindOffset}
                  onChange={(e) => set('remindOffset', e.target.value)}
                >
                  <option value="">{fa.activities.noReminder}</option>
                  {REMIND_OFFSETS.map((o) => (
                    <option key={o} value={o}>
                      {fa.activities.reminderBefore[Number(o) as 0 | 15 | 60 | 1440]}
                    </option>
                  ))}
                  {f.remindOffset === 'keep' && activity?.remindAt ? (
                    <option value="keep">{formatJalaliDateTime(activity.remindAt)}</option>
                  ) : null}
                </Select>
              )}
            </Field>
            <Field label={fa.activities.priority}>
              {(p) => (
                <Select
                  {...p}
                  value={f.priority}
                  onChange={(e) => set('priority', e.target.value as typeof f.priority)}
                >
                  {Object.entries(fa.activities.priorities).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : null}

        {!editing && f.logPast && !isNote ? (
          <div className="sm:col-span-2">
            <JalaliDateTimeField
              label={fa.activities.happenedAt}
              value={f.happenedAt}
              onChange={(v) => set('happenedAt', v)}
            />
          </div>
        ) : null}

        {showOutcome ? (
          <div className="sm:col-span-2">
            <Field label={fa.activities.outcome}>
              {(p) => (
                <Textarea
                  {...p}
                  placeholder={fa.activities.outcomePlaceholder}
                  value={f.outcome}
                  onChange={(e) => set('outcome', e.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}

        {!isNote && can(PERMISSIONS.USERS_READ) ? (
          <Field label={fa.activities.assignee}>
            {(p) => (
              <Select
                {...p}
                value={f.assigneeId}
                onChange={(e) => set('assigneeId', e.target.value)}
              >
                <option value="">{fa.activities.unassigned}</option>
                {users.data?.items
                  .filter((u) => u.status === 'ACTIVE')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        ) : null}

        <div className="sm:col-span-2">
          {lockedCustomer ? (
            <p className="text-sm">
              <span className="text-[var(--color-text-muted)]">{fa.activities.customer}: </span>
              {lockedCustomer.name}
            </p>
          ) : (
            <CustomerPicker
              value={f.customerId}
              initial={activity?.customer ?? undefined}
              onChange={(id) => setF((s) => ({ ...s, customerId: id, contactId: '', dealId: '' }))}
            />
          )}
        </div>

        {f.customerId ? (
          <>
            <Field label={fa.activities.contact}>
              {(p) => (
                <Select
                  {...p}
                  value={f.contactId}
                  onChange={(e) => set('contactId', e.target.value)}
                >
                  <option value="">—</option>
                  {activity?.contact &&
                  !customer.data?.contacts.some((c) => c.id === activity.contact?.id) ? (
                    <option value={activity.contact.id}>{activity.contact.name}</option>
                  ) : null}
                  {customer.data?.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {can(PERMISSIONS.DEALS_READ) ? (
              <Field label={fa.activities.deal}>
                {(p) => (
                  <Select {...p} value={f.dealId} onChange={(e) => set('dealId', e.target.value)}>
                    <option value="">—</option>
                    {activity?.deal &&
                    !deals.data?.items.some((d) => d.id === activity.deal?.id) ? (
                      <option value={activity.deal.id}>{activity.deal.title}</option>
                    ) : null}
                    {deals.data?.items.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </>
        ) : null}

        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
