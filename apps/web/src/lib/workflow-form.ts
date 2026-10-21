import {
  CreateWorkflowRequestSchema,
  normalizeText,
  type CreateWorkflowRequest,
  type FieldSpec,
  type WorkflowAction,
  type WorkflowCatalogDto,
  type WorkflowCondition,
  type WorkflowDto,
} from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { rialToTomanInput, tomanInputToRial } from './money';

type Trigger = WorkflowCatalogDto['triggers'][number];
export type FieldInfo = Trigger['fields'][number];
export type Recipient = 'owner' | 'actor' | 'user';

/** Editable shapes: everything is text/boolean so inputs stay controlled. */
export interface ConditionRow {
  key: string;
  field: string;
  op: WorkflowCondition['op'];
  /** Single value as typed (toman for amounts). */
  value: string;
  /** Selected values for the `in` operator. */
  values: string[];
}
export interface ActionRow {
  key: string;
  type: WorkflowAction['type'];
  to: Recipient;
  userId: string;
  title: string;
  body: string;
  dueInDays: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
}
export interface FormState {
  name: string;
  description: string;
  triggerType: string;
  conditions: ConditionRow[];
  actions: ActionRow[];
}

let seq = 0;
export const rowKey = () => `r${++seq}`;

export const emptyAction = (type: ActionRow['type'] = 'notify'): ActionRow => ({
  key: rowKey(),
  type,
  to: 'owner',
  userId: '',
  title: '',
  body: '',
  dueInDays: '1',
  priority: 'NORMAL',
});

export function emptyCondition(trigger: Trigger | undefined): ConditionRow {
  const f = trigger?.fields[0];
  return {
    key: rowKey(),
    field: f?.name ?? '',
    op: f?.operators[0] ?? 'eq',
    value: '',
    values: [],
  };
}

/** Operators the builder offers; `in` only makes sense as a checkbox group for enums. */
export function operatorsFor(f: FieldInfo | undefined): FieldInfo['operators'] {
  if (!f) return [];
  return f.operators.filter((o) => o !== 'in' || f.kind === 'enum');
}

export function stateFromDto(w: WorkflowDto, catalog: WorkflowCatalogDto): FormState {
  const trigger = catalog.triggers.find((t) => t.type === w.triggerType);
  const kindOf = (field: string): FieldSpec['kind'] | undefined =>
    trigger?.fields.find((f) => f.name === field)?.kind;
  return {
    name: w.name,
    description: w.description ?? '',
    triggerType: w.triggerType,
    conditions: w.conditions.map((c) => ({
      key: rowKey(),
      field: c.field,
      op: c.op,
      value: Array.isArray(c.value)
        ? ''
        : kindOf(c.field) === 'amount'
          ? rialToTomanInput(c.value)
          : c.value,
      values: Array.isArray(c.value) ? c.value : [],
    })),
    actions: w.actions.map((a): ActionRow => {
      const target = a.type === 'notify' ? a.to : a.assignee;
      const base = emptyAction(a.type);
      return {
        ...base,
        to: typeof target === 'string' ? target : 'user',
        userId: typeof target === 'string' ? '' : target.userId,
        title: a.title,
        ...(a.type === 'notify'
          ? { body: a.body ?? '' }
          : { dueInDays: String(a.dueInDays), priority: a.priority }),
      };
    }),
  };
}

export type BuildResult = { ok: true; value: CreateWorkflowRequest } | { ok: false; error: string };

const fail = (error: string): BuildResult => ({ ok: false, error });

/**
 * Turns the form into a request and validates it with the same schema and cross-field rules the
 * API uses, so a definition that passes here cannot be refused for being malformed.
 */
export function buildRequest(state: FormState, catalog: WorkflowCatalogDto): BuildResult {
  const trigger = catalog.triggers.find((t) => t.type === state.triggerType);
  if (!trigger) return fail(fa.workflows.trigger);

  const conditions: WorkflowCondition[] = [];
  for (const c of state.conditions) {
    const info = trigger.fields.find((f) => f.name === c.field);
    if (!info) return fail(fa.workflows.valueRequired);
    if (c.op === 'in') {
      if (c.values.length === 0) return fail(fa.workflows.pickOne);
      conditions.push({ field: c.field, op: c.op, value: c.values });
      continue;
    }
    const raw = c.value.trim();
    if (!raw) return fail(fa.workflows.valueRequired);
    if (info.kind === 'amount') {
      const rial = tomanInputToRial(raw);
      if (rial === null) return fail(fa.workflows.invalidAmount);
      conditions.push({ field: c.field, op: c.op, value: rial.toString() });
    } else if (info.kind === 'int') {
      const digits = normalizeText(raw);
      if (!/^\d{1,9}$/.test(digits)) return fail(fa.workflows.invalidNumber);
      conditions.push({ field: c.field, op: c.op, value: digits });
    } else {
      conditions.push({ field: c.field, op: c.op, value: raw });
    }
  }

  if (state.actions.length === 0) return fail(fa.workflows.minOneAction);
  const actions: WorkflowAction[] = [];
  for (const a of state.actions) {
    if (a.to === 'user' && !a.userId) return fail(fa.workflows.userRequired);
    const target = a.to === 'user' ? { userId: a.userId } : a.to;
    if (a.type === 'notify') {
      actions.push({
        type: 'notify',
        to: target,
        title: a.title,
        ...(a.body.trim() ? { body: a.body } : {}),
      });
    } else {
      const days = normalizeText(a.dueInDays.trim());
      if (!/^\d{1,3}$/.test(days)) return fail(fa.workflows.invalidNumber);
      actions.push({
        type: 'create_task',
        title: a.title,
        dueInDays: Number(days),
        priority: a.priority,
        assignee: target,
      });
    }
  }

  const parsed = CreateWorkflowRequestSchema.safeParse({
    name: state.name,
    description: state.description.trim() ? state.description : null,
    triggerType: state.triggerType,
    conditions,
    actions,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? fa.common.error);
  return { ok: true, value: parsed.data };
}

/** Appends `{{field}}` to a text, separated by a space when the text does not end with one. */
export function withPlaceholder(text: string, field: string): string {
  const sep = text === '' || /\s$/.test(text) ? '' : ' ';
  return `${text}${sep}{{${field}}}`;
}

/** One-line description of a condition for the list/run views. */
export function describeCondition(c: WorkflowCondition): string {
  const field = fa.workflows.fields[c.field] ?? c.field;
  const op = fa.workflows.operators[c.op] ?? c.op;
  const show = (v: string) => fa.workflows.enumValues[v] ?? v;
  return `${field} ${op} ${Array.isArray(c.value) ? c.value.map(show).join('، ') : show(c.value)}`;
}
