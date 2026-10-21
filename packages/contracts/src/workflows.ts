import { z } from 'zod';
import { DOMAIN_EVENT_TYPES, type DomainEventType } from './events';

/**
 * Workflow definitions (ADR 0011): a trigger, AND-ed conditions with fixed operators over a
 * whitelist of event fields, and 1–10 actions. Definitions are data; there is no expression
 * language, script or `eval`. API and UI validate with the same code below.
 */

export const WORKFLOW_NAME_MIN = 2;
export const WORKFLOW_NAME_MAX = 120;
export const WORKFLOW_DESCRIPTION_MAX = 500;
export const WORKFLOW_MAX_CONDITIONS = 10;
export const WORKFLOW_MAX_ACTIONS = 10;
/** Enabled workflows per organization. */
export const WORKFLOW_MAX_ENABLED = 50;
/** Matching workflows executed for one event. */
export const WORKFLOW_MAX_MATCHES_PER_EVENT = 20;

export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type FieldSpec =
  | { kind: 'id' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'amount' }
  | { kind: 'int' };

const OPS_BY_KIND: Record<FieldSpec['kind'], readonly ConditionOperator[]> = {
  id: ['eq', 'neq', 'in'],
  enum: ['eq', 'neq', 'in'],
  amount: CONDITION_OPERATORS,
  int: CONDITION_OPERATORS,
};

export interface TriggerDefinition {
  /** Event payload fields a condition may test. */
  fields: Readonly<Record<string, FieldSpec>>;
  /** Payload fields a `{{field}}` placeholder may use in action texts. */
  templateFields: readonly string[];
}

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
const STAGE_KINDS = ['OPEN', 'WON', 'LOST'] as const;
const id: FieldSpec = { kind: 'id' };
const amount: FieldSpec = { kind: 'amount' };

export const WORKFLOW_TRIGGERS: Record<DomainEventType, TriggerDefinition> = {
  'lead.created': {
    fields: { sourceId: id, campaignId: id, ownerId: id },
    templateFields: ['name'],
  },
  'lead.converted': {
    fields: { ownerId: id, amount },
    templateFields: ['name', 'amount'],
  },
  'deal.created': {
    fields: { amount, ownerId: id },
    templateFields: ['title', 'amount'],
  },
  'deal.stage_changed': {
    fields: { stageId: id, stageKind: { kind: 'enum', values: STAGE_KINDS }, amount },
    templateFields: ['title', 'stageKind', 'amount'],
  },
  'quote.accepted': {
    fields: { total: amount, ownerId: id },
    templateFields: ['number', 'title', 'total'],
  },
  'quote.rejected': {
    fields: { total: amount, ownerId: id },
    templateFields: ['number', 'title', 'total'],
  },
  'activity.overdue': {
    fields: { priority: { kind: 'enum', values: PRIORITIES }, assigneeId: id },
    templateFields: ['title', 'priority'],
  },
  'contract.expiring': {
    fields: { daysLeft: { kind: 'int' }, amount },
    templateFields: ['number', 'title', 'daysLeft', 'amount'],
  },
};

export const TriggerTypeSchema = z.enum(
  DOMAIN_EVENT_TYPES as [DomainEventType, ...DomainEventType[]],
);

const uuid = z.string().uuid();

const ConditionSchema = z.strictObject({
  field: z.string().min(1).max(40),
  op: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string().min(1).max(64), z.array(z.string().min(1).max(64)).min(1).max(20)]),
});
export type WorkflowCondition = z.infer<typeof ConditionSchema>;

const RecipientSchema = z.union([z.enum(['owner', 'actor']), z.strictObject({ userId: uuid })]);
export type WorkflowRecipient = z.infer<typeof RecipientSchema>;

const NotifyActionSchema = z.strictObject({
  type: z.literal('notify'),
  to: RecipientSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(1000).optional(),
});
const CreateTaskActionSchema = z.strictObject({
  type: z.literal('create_task'),
  title: z.string().trim().min(2).max(200),
  dueInDays: z.number().int().min(0).max(365),
  priority: z.enum(PRIORITIES),
  assignee: RecipientSchema,
});
const ActionSchema = z.discriminatedUnion('type', [NotifyActionSchema, CreateTaskActionSchema]);
export type WorkflowAction = z.infer<typeof ActionSchema>;
export const WORKFLOW_ACTION_TYPES = ['notify', 'create_task'] as const;

const AMOUNT_RE = /^\d{1,18}$/;

function valueProblem(spec: FieldSpec, v: string): string | null {
  switch (spec.kind) {
    case 'id':
      return uuid.safeParse(v).success ? null : 'شناسه نامعتبر است';
    case 'enum':
      return spec.values.includes(v) ? null : 'مقدار مجاز نیست';
    default:
      return AMOUNT_RE.test(v) ? null : 'عدد نامعتبر است';
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

export interface WorkflowDefinition {
  triggerType: DomainEventType;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}

/**
 * Cross-field rules a plain schema cannot express: condition fields/operators/values must belong
 * to the trigger, and placeholders must name whitelisted fields. Returns the first problem in
 * Persian, or null when the definition is valid. The service re-runs it on the merged state of an
 * update.
 */
export function checkWorkflowDefinition(def: WorkflowDefinition): string | null {
  const trigger = WORKFLOW_TRIGGERS[def.triggerType];
  for (const c of def.conditions) {
    const spec = trigger.fields[c.field];
    if (!spec) return `فیلد «${c.field}» برای این رویداد قابل شرط‌گذاری نیست`;
    if (!OPS_BY_KIND[spec.kind].includes(c.op))
      return `عملگر «${c.op}» برای فیلد «${c.field}» مجاز نیست`;
    if (c.op === 'in') {
      if (!Array.isArray(c.value)) return 'عملگر «in» فهرستی از مقادیر می‌خواهد';
    } else if (Array.isArray(c.value)) {
      return 'این عملگر فقط یک مقدار می‌پذیرد';
    }
    for (const v of Array.isArray(c.value) ? c.value : [c.value]) {
      const p = valueProblem(spec, v);
      if (p) return `فیلد «${c.field}»: ${p}`;
    }
  }
  for (const a of def.actions) {
    const texts = a.type === 'notify' ? [a.title, a.body ?? ''] : [a.title];
    for (const t of texts) {
      for (const m of t.matchAll(PLACEHOLDER)) {
        if (!trigger.templateFields.includes(m[1]!)) {
          return `جایگزین «{{${m[1]}}}» برای این رویداد مجاز نیست`;
        }
      }
    }
    if (a.type === 'create_task' && typeof a.assignee === 'string') {
      // 'owner'/'actor' are resolved at run time; nothing to check statically.
    }
  }
  return null;
}

const definitionShape = {
  triggerType: TriggerTypeSchema,
  conditions: z.array(ConditionSchema).max(WORKFLOW_MAX_CONDITIONS),
  actions: z.array(ActionSchema).min(1).max(WORKFLOW_MAX_ACTIONS),
};

const nameField = z.string().trim().min(WORKFLOW_NAME_MIN).max(WORKFLOW_NAME_MAX);
const descriptionField = z.string().trim().max(WORKFLOW_DESCRIPTION_MAX).nullable();

export const CreateWorkflowRequestSchema = z
  .strictObject({
    name: nameField,
    description: descriptionField.optional(),
    ...definitionShape,
    conditions: definitionShape.conditions.default([]),
  })
  .superRefine((v, ctx) => {
    const problem = checkWorkflowDefinition(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

export const UpdateWorkflowRequestSchema = z.strictObject({
  name: nameField.optional(),
  description: descriptionField.optional(),
  triggerType: definitionShape.triggerType.optional(),
  conditions: definitionShape.conditions.optional(),
  actions: definitionShape.actions.optional(),
});
export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;

export const WorkflowRunListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});
export type WorkflowRunListQuery = z.infer<typeof WorkflowRunListQuerySchema>;

export interface WorkflowDto {
  id: string;
  name: string;
  description: string | null;
  triggerType: DomainEventType;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  enabled: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export const WORKFLOW_RUN_STATUSES = ['SUCCEEDED', 'FAILED'] as const;
export interface WorkflowRunStep {
  action: (typeof WORKFLOW_ACTION_TYPES)[number];
  status: 'done' | 'skipped' | 'failed';
  /** Id of the notification or activity that was created. */
  createdId?: string;
  note?: string;
}
export interface WorkflowRunDto {
  id: string;
  workflowId: string;
  eventId: string;
  status: (typeof WORKFLOW_RUN_STATUSES)[number];
  startedAt: string;
  finishedAt: string;
  steps: WorkflowRunStep[];
  error: string | null;
}

export interface WorkflowCatalogDto {
  triggers: Array<{
    type: DomainEventType;
    fields: Array<{
      name: string;
      kind: FieldSpec['kind'];
      values?: readonly string[];
      operators: readonly ConditionOperator[];
    }>;
    templateFields: readonly string[];
  }>;
  actions: readonly string[];
  limits: {
    maxConditions: number;
    maxActions: number;
    maxEnabled: number;
  };
}

export function workflowCatalog(): WorkflowCatalogDto {
  return {
    triggers: DOMAIN_EVENT_TYPES.map((type) => ({
      type,
      fields: Object.entries(WORKFLOW_TRIGGERS[type].fields).map(([name, spec]) => ({
        name,
        kind: spec.kind,
        ...(spec.kind === 'enum' ? { values: spec.values } : {}),
        operators: OPS_BY_KIND[spec.kind],
      })),
      templateFields: WORKFLOW_TRIGGERS[type].templateFields,
    })),
    actions: WORKFLOW_ACTION_TYPES,
    limits: {
      maxConditions: WORKFLOW_MAX_CONDITIONS,
      maxActions: WORKFLOW_MAX_ACTIONS,
      maxEnabled: WORKFLOW_MAX_ENABLED,
    },
  };
}

/** Compares one condition with an event payload; missing/null values never satisfy a positive test. */
export function conditionMatches(c: WorkflowCondition, payload: Record<string, unknown>): boolean {
  const raw = payload[c.field];
  const have = raw === null || raw === undefined ? null : String(raw);
  const list = Array.isArray(c.value) ? c.value : [c.value];
  switch (c.op) {
    case 'eq':
      return have !== null && have === list[0];
    case 'neq':
      return have === null || have !== list[0];
    case 'in':
      return have !== null && list.includes(have);
    default: {
      if (have === null || !AMOUNT_RE.test(have) || !AMOUNT_RE.test(list[0]!)) return false;
      const a = BigInt(have);
      const b = BigInt(list[0]!);
      return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b;
    }
  }
}

/** All conditions must hold (AND); no conditions always match. */
export function conditionsMatch(
  conditions: readonly WorkflowCondition[],
  payload: Record<string, unknown>,
): boolean {
  return conditions.every((c) => conditionMatches(c, payload));
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toPersian = (s: string) => s.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]!);
const groupThousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const ENUM_LABELS: Record<string, string> = {
  LOW: 'کم',
  NORMAL: 'معمولی',
  HIGH: 'بالا',
  OPEN: 'باز',
  WON: 'موفق',
  LOST: 'ناموفق',
};
const MONEY_FIELDS = new Set(['amount', 'total']);

/**
 * Fills `{{field}}` placeholders with whitelisted payload values as plain text. Fields outside the
 * trigger's whitelist are replaced by nothing, so a template can never read other event data.
 */
export function renderTemplate(
  template: string,
  type: DomainEventType,
  payload: Record<string, unknown>,
): string {
  const allowed = WORKFLOW_TRIGGERS[type].templateFields;
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    if (!allowed.includes(name)) return '';
    const raw = payload[name];
    if (raw === null || raw === undefined) return '';
    const text = String(raw);
    if (MONEY_FIELDS.has(name) && AMOUNT_RE.test(text)) {
      return `${toPersian(groupThousands(text)).replace(/,/g, '٬')} ریال`;
    }
    if (ENUM_LABELS[text]) return ENUM_LABELS[text];
    return /^\d+$/.test(text) ? toPersian(text) : text;
  });
}
