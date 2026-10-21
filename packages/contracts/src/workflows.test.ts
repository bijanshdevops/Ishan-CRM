import { describe, expect, it } from 'vitest';
import { DOMAIN_EVENT_TYPES } from './events';
import {
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema,
  WORKFLOW_TRIGGERS,
  checkWorkflowDefinition,
  conditionMatches,
  conditionsMatch,
  renderTemplate,
  workflowCatalog,
  type WorkflowCondition,
} from './workflows';

const ID = '0197c0de-0000-7000-8000-000000000001';
const ID2 = '0197c0de-0000-7000-8000-000000000002';
const notify = { type: 'notify', to: 'owner', title: 'فرصت {{title}}' } as const;
const valid = {
  name: 'پیگیری فرصت',
  triggerType: 'deal.stage_changed',
  conditions: [{ field: 'stageKind', op: 'eq', value: 'WON' }],
  actions: [notify],
};

describe('workflow schemas', () => {
  it('accepts a valid definition and defaults conditions to none', () => {
    expect(CreateWorkflowRequestSchema.safeParse(valid).success).toBe(true);
    const bare = CreateWorkflowRequestSchema.safeParse({
      name: 'x'.repeat(5),
      triggerType: 'lead.created',
      actions: [notify.to ? { ...notify, title: 'سرنخ {{name}}' } : notify],
    });
    expect(bare.success && bare.data.conditions).toEqual([]);
  });

  it('rejects unknown keys, bad lengths and unknown triggers or actions', () => {
    const bad = (over: object) =>
      CreateWorkflowRequestSchema.safeParse({ ...valid, ...over }).success;
    expect(bad({ extra: 1 })).toBe(false);
    expect(bad({ name: 'a' })).toBe(false);
    expect(bad({ name: 'x'.repeat(121) })).toBe(false);
    expect(bad({ triggerType: 'deal.deleted' })).toBe(false);
    expect(bad({ actions: [] })).toBe(false);
    expect(bad({ actions: Array.from({ length: 11 }, () => notify) })).toBe(false);
    expect(bad({ actions: [{ type: 'webhook', url: 'https://x' }] })).toBe(false);
    expect(bad({ actions: [{ ...notify, extra: true }] })).toBe(false);
    expect(bad({ actions: [{ type: 'notify', to: 'everyone', title: 't' }] })).toBe(false);
    expect(bad({ actions: [{ ...notify, title: '' }] })).toBe(false);
    expect(bad({ conditions: Array.from({ length: 11 }, () => valid.conditions[0]) })).toBe(false);
  });

  it('validates create_task parameters', () => {
    const task = (over: object) => ({
      ...valid,
      actions: [
        {
          type: 'create_task',
          title: 'پیگیری',
          dueInDays: 2,
          priority: 'HIGH',
          assignee: 'owner',
          ...over,
        },
      ],
    });
    expect(CreateWorkflowRequestSchema.safeParse(task({})).success).toBe(true);
    expect(CreateWorkflowRequestSchema.safeParse(task({ assignee: { userId: ID } })).success).toBe(
      true,
    );
    expect(CreateWorkflowRequestSchema.safeParse(task({ dueInDays: -1 })).success).toBe(false);
    expect(CreateWorkflowRequestSchema.safeParse(task({ dueInDays: 366 })).success).toBe(false);
    expect(CreateWorkflowRequestSchema.safeParse(task({ priority: 'URGENT' })).success).toBe(false);
    expect(CreateWorkflowRequestSchema.safeParse(task({ assignee: { userId: 'x' } })).success).toBe(
      false,
    );
  });

  it('keeps update strict and partial', () => {
    expect(UpdateWorkflowRequestSchema.safeParse({ name: 'نام جدید' }).success).toBe(true);
    expect(UpdateWorkflowRequestSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(UpdateWorkflowRequestSchema.safeParse({ actions: [] }).success).toBe(false);
  });
});

describe('checkWorkflowDefinition', () => {
  const def = (conditions: WorkflowCondition[], title = 'x') => ({
    triggerType: 'deal.stage_changed' as const,
    conditions,
    actions: [{ ...notify, title }],
  });

  it('only allows whitelisted fields, operators and values of the trigger', () => {
    expect(
      checkWorkflowDefinition(def([{ field: 'stageKind', op: 'in', value: ['WON', 'LOST'] }])),
    ).toBeNull();
    expect(checkWorkflowDefinition(def([{ field: 'title', op: 'eq', value: 'x' }]))).toContain(
      'title',
    );
    expect(checkWorkflowDefinition(def([{ field: 'ownerId', op: 'eq', value: ID }]))).toContain(
      'ownerId',
    );
    expect(
      checkWorkflowDefinition(def([{ field: 'stageKind', op: 'gt', value: 'WON' }])),
    ).toContain('عملگر');
    expect(
      checkWorkflowDefinition(def([{ field: 'stageKind', op: 'eq', value: 'DONE' }])),
    ).toContain('مجاز نیست');
    expect(checkWorkflowDefinition(def([{ field: 'stageId', op: 'eq', value: 'nope' }]))).toContain(
      'شناسه',
    );
    expect(checkWorkflowDefinition(def([{ field: 'amount', op: 'gte', value: '12.5' }]))).toContain(
      'عدد',
    );
    expect(
      checkWorkflowDefinition(def([{ field: 'amount', op: 'gte', value: '5000000' }])),
    ).toBeNull();
    expect(checkWorkflowDefinition(def([{ field: 'stageId', op: 'in', value: ID }]))).toContain(
      'فهرست',
    );
    expect(checkWorkflowDefinition(def([{ field: 'stageId', op: 'eq', value: [ID] }]))).toContain(
      'یک مقدار',
    );
  });

  it('only allows whitelisted placeholders', () => {
    expect(checkWorkflowDefinition(def([], '{{title}} {{ amount }}'))).toBeNull();
    expect(checkWorkflowDefinition(def([], '{{ownerId}}'))).toContain('ownerId');
    expect(checkWorkflowDefinition(def([], '{{constructor}}'))).toContain('constructor');
  });

  it('is consistent with the catalog for every trigger', () => {
    const cat = workflowCatalog();
    expect(cat.triggers.map((t) => t.type)).toEqual(DOMAIN_EVENT_TYPES);
    for (const t of cat.triggers) {
      expect(t.fields.map((f) => f.name).sort()).toEqual(
        Object.keys(WORKFLOW_TRIGGERS[t.type].fields).sort(),
      );
      for (const f of t.fields) expect(f.operators.length).toBeGreaterThan(0);
    }
  });
});

describe('conditionMatches', () => {
  const c = (op: WorkflowCondition['op'], value: WorkflowCondition['value'], field = 'amount') =>
    ({ field, op, value }) as WorkflowCondition;

  it('compares amounts as exact integers, beyond Number precision', () => {
    const big = '9007199254740993';
    expect(conditionMatches(c('gt', '9007199254740992'), { amount: big })).toBe(true);
    expect(conditionMatches(c('lt', '9007199254740992'), { amount: big })).toBe(false);
    expect(conditionMatches(c('gte', '10'), { amount: '10' })).toBe(true);
    expect(conditionMatches(c('lte', '9'), { amount: '10' })).toBe(false);
    expect(conditionMatches(c('eq', '10'), { amount: '10' })).toBe(true);
  });

  it('treats a missing or null field as never satisfying a positive test', () => {
    expect(conditionMatches(c('eq', ID, 'ownerId'), { ownerId: null })).toBe(false);
    expect(conditionMatches(c('in', [ID], 'ownerId'), {})).toBe(false);
    expect(conditionMatches(c('gt', '1'), { amount: null })).toBe(false);
    expect(conditionMatches(c('neq', ID, 'ownerId'), { ownerId: null })).toBe(true);
  });

  it('supports in/neq on ids, enums and integers', () => {
    expect(conditionMatches(c('in', [ID, ID2], 'ownerId'), { ownerId: ID2 })).toBe(true);
    expect(conditionMatches(c('neq', ID, 'ownerId'), { ownerId: ID2 })).toBe(true);
    expect(conditionMatches(c('eq', '7', 'daysLeft'), { daysLeft: 7 })).toBe(true);
    expect(conditionMatches(c('lte', '10', 'daysLeft'), { daysLeft: 3 })).toBe(true);
  });

  it('requires every condition (AND); none always matches', () => {
    const p = { amount: '100', stageKind: 'WON' };
    expect(conditionsMatch([], p)).toBe(true);
    expect(conditionsMatch([c('gte', '50'), c('eq', 'WON', 'stageKind')], p)).toBe(true);
    expect(conditionsMatch([c('gte', '50'), c('eq', 'LOST', 'stageKind')], p)).toBe(false);
  });
});

describe('renderTemplate', () => {
  it('fills whitelisted fields as plain text and formats money, enums and numbers', () => {
    const p = { title: 'قرارداد <b>الف</b>', amount: '12500000', stageKind: 'WON', daysLeft: 5 };
    expect(renderTemplate('{{title}}', 'deal.stage_changed', p)).toBe('قرارداد <b>الف</b>');
    expect(renderTemplate('مبلغ {{ amount }}', 'deal.stage_changed', p)).toBe(
      'مبلغ ۱۲٬۵۰۰٬۰۰۰ ریال',
    );
    expect(renderTemplate('{{stageKind}}', 'deal.stage_changed', p)).toBe('موفق');
    expect(renderTemplate('{{daysLeft}} روز', 'contract.expiring', p)).toBe('۵ روز');
  });

  it('never reads fields outside the whitelist and ignores malformed placeholders', () => {
    const p = { title: 't', ownerId: ID, customerId: ID2 };
    expect(
      renderTemplate('[{{ownerId}}][{{customerId}}][{{constructor}}]', 'deal.created', p),
    ).toBe('[][][]');
    expect(renderTemplate('{{ title', 'deal.created', p)).toBe('{{ title');
    expect(renderTemplate('{{missing}}', 'deal.created', {})).toBe('');
  });
});
