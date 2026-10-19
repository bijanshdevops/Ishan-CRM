import { describe, expect, it } from 'vitest';
import { CalendarQuerySchema, CreateActivityRequestSchema, checkActivityShape } from './activities';

const T1 = '2026-10-20T08:00:00.000Z';
const T2 = '2026-10-20T09:00:00.000Z';

describe('activity contracts', () => {
  it('requires a due time for planned calls/meetings/tasks', () => {
    expect(
      CreateActivityRequestSchema.safeParse({ type: 'CALL', title: 'تماس پیگیری' }).success,
    ).toBe(false);
    expect(
      CreateActivityRequestSchema.safeParse({ type: 'CALL', title: 'تماس پیگیری', dueAt: T1 })
        .success,
    ).toBe(true);
  });

  it('notes need text and cannot be scheduled', () => {
    expect(CreateActivityRequestSchema.safeParse({ type: 'NOTE' }).success).toBe(false);
    expect(
      CreateActivityRequestSchema.safeParse({ type: 'NOTE', description: 'متن' }).success,
    ).toBe(true);
    expect(
      CreateActivityRequestSchema.safeParse({ type: 'NOTE', description: 'متن', dueAt: T1 })
        .success,
    ).toBe(false);
    expect(
      CreateActivityRequestSchema.safeParse({ type: 'NOTE', description: 'x', status: 'PLANNED' })
        .success,
    ).toBe(false);
  });

  it('allows logging a finished call without a due time', () => {
    const r = CreateActivityRequestSchema.safeParse({
      type: 'CALL',
      title: 'تماس انجام‌شده',
      status: 'DONE',
      completedAt: T1,
    });
    expect(r.success).toBe(true);
  });

  it('validates time ordering and task shape', () => {
    expect(
      checkActivityShape({
        type: 'MEETING',
        status: 'PLANNED',
        title: 'جلسه',
        dueAt: T2,
        endAt: T1,
      }),
    ).not.toBeNull();
    expect(
      checkActivityShape({ type: 'TASK', status: 'PLANNED', title: 'کار', dueAt: T2, endAt: T2 }),
    ).not.toBeNull();
    expect(
      checkActivityShape({
        type: 'TASK',
        status: 'PLANNED',
        title: 'کار',
        dueAt: T1,
        remindAt: T2,
      }),
    ).not.toBeNull();
    expect(
      checkActivityShape({
        type: 'TASK',
        status: 'PLANNED',
        title: 'کار',
        dueAt: T2,
        remindAt: T1,
      }),
    ).toBeNull();
  });

  it('bounds the calendar window', () => {
    expect(
      CalendarQuerySchema.safeParse({ from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      CalendarQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' })
        .success,
    ).toBe(false);
    expect(
      CalendarQuerySchema.safeParse({ from: '2026-10-31T00:00:00Z', to: '2026-10-01T00:00:00Z' })
        .success,
    ).toBe(false);
  });
});
