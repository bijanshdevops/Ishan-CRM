'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PERMISSIONS,
  type CampaignDto,
  type LeadSourceDto,
  type Page,
  type StageDto,
  type UserDto,
  type WorkflowCatalogDto,
  type WorkflowDto,
} from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  buildRequest,
  emptyAction,
  emptyCondition,
  operatorsFor,
  stateFromDto,
  withPlaceholder,
  type ActionRow,
  type ConditionRow,
  type FieldInfo,
  type FormState,
} from '@/lib/workflow-form';
import { Button, Card, ErrorBanner, Field, Input, Select, Textarea } from './ui';

const t = fa.workflows;

function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Choices for id-valued fields, loaded only when the user may read them; else a plain id input. */
function useRefs() {
  const { can } = useAuth();
  const users = useQuery({
    queryKey: ['users', 'owners'],
    enabled: can(PERMISSIONS.USERS_READ),
    queryFn: () => api<Page<UserDto>>('/users?limit=100'),
  });
  const stages = useQuery({
    queryKey: ['pipeline', 'stages'],
    enabled: can(PERMISSIONS.DEALS_READ),
    queryFn: () => api<StageDto[]>('/pipeline/stages'),
  });
  const sources = useQuery({
    queryKey: ['lead-sources', 'all'],
    enabled: can(PERMISSIONS.LEADS_READ),
    queryFn: () => api<LeadSourceDto[]>('/lead-sources'),
  });
  const campaigns = useQuery({
    queryKey: ['campaigns', 'picker'],
    enabled: can(PERMISSIONS.CAMPAIGNS_READ),
    queryFn: () => api<Page<CampaignDto>>('/campaigns?limit=100'),
  });
  const options: Record<string, Array<{ id: string; name: string }> | undefined> = {
    ownerId: users.data?.items.map((u) => ({ id: u.id, name: u.name })),
    assigneeId: users.data?.items.map((u) => ({ id: u.id, name: u.name })),
    stageId: stages.data?.map((s) => ({ id: s.id, name: s.name })),
    sourceId: sources.data?.map((s) => ({ id: s.id, name: s.name })),
    campaignId: campaigns.data?.items.map((c) => ({ id: c.id, name: c.name })),
  };
  return { options, users: users.data?.items };
}

function ConditionValue({
  row,
  info,
  options,
  onChange,
}: {
  row: ConditionRow;
  info: FieldInfo | undefined;
  options: Array<{ id: string; name: string }> | undefined;
  onChange: (patch: Partial<ConditionRow>) => void;
}) {
  if (info?.kind === 'enum' && row.op === 'in') {
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">{t.value}</legend>
        <div className="flex flex-wrap gap-4">
          {info.values?.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={row.values.includes(v)}
                onChange={(e) =>
                  onChange({
                    values: e.target.checked
                      ? [...row.values, v]
                      : row.values.filter((x) => x !== v),
                  })
                }
              />
              {t.enumValues[v] ?? v}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <Field label={t.value}>
      {(p) =>
        info?.kind === 'enum' ? (
          <Select {...p} value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
            <option value="">{t.anyOption}</option>
            {info.values?.map((v) => (
              <option key={v} value={v}>
                {t.enumValues[v] ?? v}
              </option>
            ))}
          </Select>
        ) : info?.kind === 'id' && options ? (
          <Select {...p} value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
            <option value="">{t.anyOption}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            {...p}
            inputMode={info?.kind === 'id' ? undefined : 'numeric'}
            dir={info?.kind === 'id' ? 'ltr' : undefined}
            value={row.value}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        )
      }
    </Field>
  );
}

function RowTools({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        className="min-h-8 px-2"
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        {t.moveUp}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="min-h-8 px-2"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        {t.moveDown}
      </Button>
      <Button type="button" variant="ghost" className="min-h-8 px-2" onClick={onRemove}>
        {t.remove}
      </Button>
    </div>
  );
}

/**
 * Builder for one workflow: trigger, conditions and actions. Everything the user types is
 * validated with the shared contract before it is sent (see lib/workflow-form).
 */
export function WorkflowForm({
  workflow,
  catalog,
  readOnly = false,
  onSaved,
}: {
  workflow?: WorkflowDto;
  catalog: WorkflowCatalogDto;
  readOnly?: boolean;
  onSaved: (w: WorkflowDto) => void;
}) {
  const refs = useRefs();
  const [f, setF] = useState<FormState>(() =>
    workflow
      ? stateFromDto(workflow, catalog)
      : {
          name: '',
          description: '',
          triggerType: catalog.triggers[0]!.type,
          conditions: [],
          actions: [emptyAction('notify')],
        },
  );
  const [error, setError] = useState<string | null>(null);
  const trigger = catalog.triggers.find((x) => x.type === f.triggerType);
  const patchCond = (key: string, patch: Partial<ConditionRow>) =>
    setF((s) => ({
      ...s,
      conditions: s.conditions.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  const patchAct = (key: string, patch: Partial<ActionRow>) =>
    setF((s) => ({
      ...s,
      actions: s.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    }));

  const save = useMutation({
    mutationFn: async () => {
      const built = buildRequest(f, catalog);
      if (!built.ok) throw new Error(built.error);
      return workflow
        ? api<WorkflowDto>(`/workflows/${workflow.id}`, {
            method: 'PATCH',
            body: built.value,
            version: workflow.updatedAt,
          })
        : api<WorkflowDto>('/workflows', { method: 'POST', body: built.value });
    },
    onSuccess: onSaved,
    onError: (e) =>
      setError(
        e instanceof ApiClientError && e.status === 412
          ? t.stale
          : e instanceof Error
            ? e.message
            : fa.common.error,
      ),
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <fieldset disabled={readOnly || save.isPending} className="flex flex-col gap-6">
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t.name}>
              {(p) => (
                <Input
                  {...p}
                  required
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t.trigger}>
              {(p) => (
                <Select
                  {...p}
                  value={f.triggerType}
                  onChange={(e) => {
                    // conditions of the old trigger make no sense for the new one
                    setF({ ...f, triggerType: e.target.value, conditions: [] });
                  }}
                >
                  {catalog.triggers.map((x) => (
                    <option key={x.type} value={x.type}>
                      {t.triggers[x.type] ?? x.type}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="md:col-span-2">
              <Field label={t.description}>
                {(p) => (
                  <Textarea
                    {...p}
                    value={f.description}
                    onChange={(e) => setF({ ...f, description: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </div>
        </Card>

        <Card
          title={t.conditions}
          actions={
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setF((s) => ({ ...s, conditions: [...s.conditions, emptyCondition(trigger)] }))
              }
            >
              {t.addCondition}
            </Button>
          }
        >
          {f.conditions.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t.conditionsHint}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {f.conditions.map((c, i) => {
                const info = trigger?.fields.find((x) => x.name === c.field);
                return (
                  <li
                    key={c.key}
                    className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-start"
                  >
                    <Field label={t.field}>
                      {(p) => (
                        <Select
                          {...p}
                          value={c.field}
                          onChange={(e) => {
                            const next = trigger?.fields.find((x) => x.name === e.target.value);
                            patchCond(c.key, {
                              field: e.target.value,
                              op: operatorsFor(next)[0] ?? 'eq',
                              value: '',
                              values: [],
                            });
                          }}
                        >
                          {trigger?.fields.map((x) => (
                            <option key={x.name} value={x.name}>
                              {t.fields[x.name] ?? x.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t.operator}>
                      {(p) => (
                        <Select
                          {...p}
                          value={c.op}
                          onChange={(e) =>
                            patchCond(c.key, {
                              op: e.target.value as ConditionRow['op'],
                              value: '',
                              values: [],
                            })
                          }
                        >
                          {operatorsFor(info).map((o) => (
                            <option key={o} value={o}>
                              {t.operators[o] ?? o}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <ConditionValue
                      row={c}
                      info={info}
                      options={refs.options[c.field]}
                      onChange={(patch) => patchCond(c.key, patch)}
                    />
                    <RowTools
                      index={i}
                      count={f.conditions.length}
                      onMove={(by) =>
                        setF((s) => ({ ...s, conditions: move(s.conditions, i, by) }))
                      }
                      onRemove={() =>
                        setF((s) => ({
                          ...s,
                          conditions: s.conditions.filter((x) => x.key !== c.key),
                        }))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title={t.actions}
          actions={
            <Button
              type="button"
              variant="secondary"
              onClick={() => setF((s) => ({ ...s, actions: [...s.actions, emptyAction()] }))}
            >
              {t.addAction}
            </Button>
          }
        >
          <ul className="flex flex-col gap-4">
            {f.actions.map((a, i) => (
              <li
                key={a.key}
                className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
              >
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-start">
                  <Field label={t.actionType}>
                    {(p) => (
                      <Select
                        {...p}
                        value={a.type}
                        onChange={(e) =>
                          patchAct(a.key, { type: e.target.value as ActionRow['type'] })
                        }
                      >
                        {catalog.actions.map((x) => (
                          <option key={x} value={x}>
                            {t.actionTypes[x] ?? x}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={t.recipient}>
                    {(p) => (
                      <Select
                        {...p}
                        value={a.to}
                        onChange={(e) => patchAct(a.key, { to: e.target.value as ActionRow['to'] })}
                      >
                        {(['owner', 'actor', 'user'] as const).map((r) => (
                          <option key={r} value={r}>
                            {t.recipients[r]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {a.to === 'user' ? (
                    <Field label={t.specificUser}>
                      {(p) =>
                        refs.users ? (
                          <Select
                            {...p}
                            value={a.userId}
                            onChange={(e) => patchAct(a.key, { userId: e.target.value })}
                          >
                            <option value="">{t.pickUser}</option>
                            {refs.users
                              .filter((u) => u.status === 'ACTIVE')
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                          </Select>
                        ) : (
                          <Input
                            {...p}
                            dir="ltr"
                            value={a.userId}
                            onChange={(e) => patchAct(a.key, { userId: e.target.value })}
                          />
                        )
                      }
                    </Field>
                  ) : (
                    <span />
                  )}
                  <RowTools
                    index={i}
                    count={f.actions.length}
                    onMove={(by) => setF((s) => ({ ...s, actions: move(s.actions, i, by) }))}
                    onRemove={() =>
                      setF((s) => ({ ...s, actions: s.actions.filter((x) => x.key !== a.key) }))
                    }
                  />
                </div>
                <Field label={t.actionTitle} hint={t.insertHint}>
                  {(p) => (
                    <Input
                      {...p}
                      value={a.title}
                      onChange={(e) => patchAct(a.key, { title: e.target.value })}
                    />
                  )}
                </Field>
                {a.type === 'notify' ? (
                  <Field label={t.body}>
                    {(p) => (
                      <Textarea
                        {...p}
                        value={a.body}
                        onChange={(e) => patchAct(a.key, { body: e.target.value })}
                      />
                    )}
                  </Field>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label={t.dueInDays}>
                      {(p) => (
                        <Input
                          {...p}
                          inputMode="numeric"
                          value={a.dueInDays}
                          onChange={(e) => patchAct(a.key, { dueInDays: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={t.priority}>
                      {(p) => (
                        <Select
                          {...p}
                          value={a.priority}
                          onChange={(e) =>
                            patchAct(a.key, { priority: e.target.value as ActionRow['priority'] })
                          }
                        >
                          {(['LOW', 'NORMAL', 'HIGH'] as const).map((v) => (
                            <option key={v} value={v}>
                              {t.enumValues[v]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                )}
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={t.insertField}
                >
                  <span className="text-sm text-[var(--color-text-muted)]">{t.insertField}:</span>
                  {trigger?.templateFields.map((name) => (
                    <Button
                      key={name}
                      type="button"
                      variant="secondary"
                      className="min-h-8 px-3"
                      onClick={() => patchAct(a.key, { title: withPlaceholder(a.title, name) })}
                    >
                      {t.templateFields[name] ?? name}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </fieldset>

      {error ? <ErrorBanner message={error} /> : null}
      {readOnly ? null : (
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            {t.save}
          </Button>
        </div>
      )}
    </form>
  );
}
