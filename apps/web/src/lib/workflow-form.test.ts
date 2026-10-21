import { workflowCatalog, type WorkflowDto } from '@ishan/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  describeCondition,
  emptyAction,
  emptyCondition,
  operatorsFor,
  stateFromDto,
  withPlaceholder,
  type FormState,
} from './workflow-form';

const catalog = workflowCatalog();
const stage = catalog.triggers.find((t) => t.type === 'deal.stage_changed')!;
const ID = '0197c0de-0000-7000-8000-000000000001';

const base = (over: Partial<FormState> = {}): FormState => ({
  name: 'پیگیری برنده‌ها',
  description: '',
  triggerType: 'deal.stage_changed',
  conditions: [],
  actions: [{ ...emptyAction('notify'), title: 'فرصت {{title}} برنده شد' }],
  ...over,
});

describe('buildRequest', () => {
  it('builds a valid request and converts toman amounts to integer rials', () => {
    const r = buildRequest(
      base({
        conditions: [
          { key: 'a', field: 'amount', op: 'gte', value: '۵٬۰۰۰٬۰۰۰', values: [] },
          { key: 'b', field: 'stageKind', op: 'in', value: '', values: ['WON', 'LOST'] },
        ],
      }),
      catalog,
    );
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.value.conditions).toEqual([
        { field: 'amount', op: 'gte', value: '50000000' },
        { field: 'stageKind', op: 'in', value: ['WON', 'LOST'] },
      ]);
      expect(r.value.description).toBeNull();
    }
  });

  it('builds task and recipient shapes', () => {
    const r = buildRequest(
      base({
        actions: [
          {
            ...emptyAction('create_task'),
            title: 'پیگیری {{title}}',
            dueInDays: '۳',
            priority: 'HIGH',
            to: 'user',
            userId: ID,
          },
          { ...emptyAction('notify'), title: 'x', to: 'actor', body: 'متن' },
        ],
      }),
      catalog,
    );
    expect(r.ok && r.value.actions).toEqual([
      {
        type: 'create_task',
        title: 'پیگیری {{title}}',
        dueInDays: 3,
        priority: 'HIGH',
        assignee: { userId: ID },
      },
      { type: 'notify', to: 'actor', title: 'x', body: 'متن' },
    ]);
  });

  it('reports the first problem in Persian instead of sending a bad request', () => {
    const err = (s: FormState) => {
      const r = buildRequest(s, catalog);
      return r.ok ? null : r.error;
    };
    expect(err(base({ actions: [] }))).toContain('حداقل یک کار');
    expect(
      err(base({ conditions: [{ key: 'a', field: 'amount', op: 'gt', value: '', values: [] }] })),
    ).toContain('مقدار');
    expect(
      err(
        base({ conditions: [{ key: 'a', field: 'amount', op: 'gt', value: 'abc', values: [] }] }),
      ),
    ).toContain('تومان');
    expect(
      err(
        base({ conditions: [{ key: 'a', field: 'stageKind', op: 'in', value: '', values: [] }] }),
      ),
    ).toContain('گزینه');
    expect(
      err(base({ actions: [{ ...emptyAction(), title: 't', to: 'user', userId: '' }] })),
    ).toContain('کاربر');
    expect(
      err(base({ actions: [{ ...emptyAction('create_task'), title: 'وظیفه', dueInDays: 'x' }] })),
    ).toContain('عدد');
    // a placeholder outside the trigger's whitelist is refused by the shared rules
    expect(err(base({ actions: [{ ...emptyAction(), title: '{{ownerId}}' }] }))).toContain(
      'ownerId',
    );
    expect(err(base({ name: 'a' }))).toBeTruthy();
  });
});

describe('form helpers', () => {
  it('offers `in` only for enum fields', () => {
    const kind = stage.fields.find((f) => f.name === 'stageKind');
    const stageId = stage.fields.find((f) => f.name === 'stageId');
    const amount = stage.fields.find((f) => f.name === 'amount');
    expect(operatorsFor(kind)).toContain('in');
    expect(operatorsFor(stageId)).toEqual(['eq', 'neq']);
    expect(operatorsFor(amount)).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
    expect(operatorsFor(undefined)).toEqual([]);
  });

  it('starts a condition on the trigger’s first field', () => {
    expect(emptyCondition(stage).field).toBe('stageId');
    expect(emptyCondition(undefined).field).toBe('');
  });

  it('inserts placeholders with a separating space', () => {
    expect(withPlaceholder('', 'title')).toBe('{{title}}');
    expect(withPlaceholder('فرصت', 'title')).toBe('فرصت {{title}}');
    expect(withPlaceholder('فرصت ', 'title')).toBe('فرصت {{title}}');
  });

  it('round-trips a stored workflow through the form (rials ↔ toman)', () => {
    const dto: WorkflowDto = {
      id: ID,
      name: 'گردش‌کار',
      description: 'توضیح',
      triggerType: 'deal.stage_changed',
      conditions: [
        { field: 'amount', op: 'gte', value: '50000000' },
        { field: 'stageKind', op: 'in', value: ['WON'] },
      ],
      actions: [
        { type: 'notify', to: { userId: ID }, title: 'سلام' },
        { type: 'create_task', title: 'کار', dueInDays: 2, priority: 'LOW', assignee: 'owner' },
      ],
      enabled: false,
      createdById: ID,
      createdAt: '2026-10-21T00:00:00.000Z',
      updatedAt: '2026-10-21T00:00:00.000Z',
    };
    const state = stateFromDto(dto, catalog);
    expect(state.conditions[0]).toMatchObject({ value: '5000000' });
    expect(state.actions[0]).toMatchObject({ to: 'user', userId: ID });
    const r = buildRequest(state, catalog);
    expect(r.ok && r.value.conditions).toEqual(dto.conditions);
    expect(r.ok && r.value.actions).toEqual(dto.actions);
  });

  it('describes conditions in Persian', () => {
    expect(describeCondition({ field: 'stageKind', op: 'in', value: ['WON', 'LOST'] })).toBe(
      'نوع مرحله یکی از این‌ها موفق، ناموفق',
    );
  });
});
