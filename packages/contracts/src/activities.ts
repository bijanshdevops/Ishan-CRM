import { z } from 'zod';

export const ACTIVITY_TYPES = ['CALL', 'MEETING', 'TASK', 'NOTE'] as const;
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const ACTIVITY_STATUSES = ['PLANNED', 'DONE', 'CANCELED'] as const;
export const ActivityStatusSchema = z.enum(ACTIVITY_STATUSES);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const ACTIVITY_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export const ActivityPrioritySchema = z.enum(ACTIVITY_PRIORITIES);
export type ActivityPriority = z.infer<typeof ActivityPrioritySchema>;

/** Largest window the calendar endpoint serves in one request. */
export const MAX_CALENDAR_DAYS = 62;

/** ISO-8601 instant (UTC `Z` or an explicit offset). Stored as timestamptz. */
const Instant = z.iso.datetime({ offset: true, message: 'زمان نامعتبر است' });
const nullableInstant = Instant.nullable().optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Cross-field rules shared by the request schema (create) and the service
 * (which re-checks the merged state on update). Returns a Persian message
 * for the first violated rule, or null when the shape is valid.
 */
export interface ActivityShape {
  type: ActivityType;
  status: ActivityStatus;
  title?: string | null;
  description?: string | null;
  dueAt?: string | Date | null;
  endAt?: string | Date | null;
  remindAt?: string | Date | null;
}

const ms = (v: string | Date) => (v instanceof Date ? v.getTime() : Date.parse(v));

export function checkActivityShape(a: ActivityShape): string | null {
  if (a.type === 'NOTE') {
    if (a.status !== 'DONE') return 'یادداشت همیشه ثبت‌شده است';
    if (!a.description?.trim()) return 'متن یادداشت الزامی است';
    if (a.dueAt || a.endAt || a.remindAt) return 'یادداشت زمان‌بندی ندارد';
    return null;
  }
  if (!a.title || a.title.trim().length < 2) return 'عنوان باید حداقل ۲ نویسه باشد';
  if (a.status === 'PLANNED' && !a.dueAt) return 'زمان انجام الزامی است';
  if (a.remindAt && a.status !== 'PLANNED')
    return 'یادآوری فقط برای فعالیت‌های برنامه‌ریزی‌شده است';
  if (a.endAt) {
    if (a.type === 'TASK') return 'وظیفه زمان پایان ندارد';
    if (!a.dueAt) return 'برای زمان پایان، زمان شروع الزامی است';
    if (ms(a.endAt) < ms(a.dueAt)) return 'زمان پایان نمی‌تواند پیش از شروع باشد';
  }
  if (a.remindAt && a.dueAt && ms(a.remindAt) > ms(a.dueAt)) {
    return 'یادآوری باید پیش از زمان انجام باشد';
  }
  return null;
}

const links = {
  assigneeId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
};

export const CreateActivityRequestSchema = z
  .object({
    type: ActivityTypeSchema,
    /** Defaults: notes are DONE, everything else PLANNED. Calls/meetings may be logged as DONE. */
    status: z.enum(['PLANNED', 'DONE']).optional(),
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(8000).optional(),
    dueAt: Instant.optional(),
    endAt: Instant.optional(),
    /** When a DONE activity actually happened (defaults to now). */
    completedAt: Instant.optional(),
    remindAt: Instant.optional(),
    priority: ActivityPrioritySchema.default('NORMAL'),
    outcome: z.string().trim().max(2000).optional(),
    ...links,
  })
  .superRefine((v, ctx) => {
    const status = v.status ?? (v.type === 'NOTE' ? 'DONE' : 'PLANNED');
    const problem = checkActivityShape({ ...v, status });
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
    if (status === 'PLANNED' && v.completedAt) {
      ctx.addIssue({ code: 'custom', message: 'فعالیت برنامه‌ریزی‌شده زمان تکمیل ندارد' });
    }
  });
export type CreateActivityRequest = z.infer<typeof CreateActivityRequestSchema>;

export const UpdateActivityRequestSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: nullableText(8000),
  dueAt: nullableInstant,
  endAt: nullableInstant,
  remindAt: nullableInstant,
  priority: ActivityPrioritySchema.optional(),
  outcome: nullableText(2000),
  ...links,
});
export type UpdateActivityRequest = z.infer<typeof UpdateActivityRequestSchema>;

export const CompleteActivityRequestSchema = z.object({
  outcome: z.string().trim().max(2000).optional(),
  completedAt: Instant.optional(),
});
export type CompleteActivityRequest = z.infer<typeof CompleteActivityRequestSchema>;

export const ActivityListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  type: ActivityTypeSchema.optional(),
  status: ActivityStatusSchema.optional(),
  /** A user id, or `me` for the signed-in user. */
  assigneeId: z.union([z.literal('me'), z.string().uuid()]).optional(),
  customerId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  /** Inclusive window on `dueAt`. */
  from: Instant.optional(),
  to: Instant.optional(),
  /** Only PLANNED activities whose `dueAt` is in the past. */
  overdue: z.enum(['true']).optional(),
  /** `due` (soonest first, default for planned work) or `recent` (newest first). */
  sort: z.enum(['recent', 'due']).default('recent'),
});
export type ActivityListQuery = z.infer<typeof ActivityListQuerySchema>;

export const CalendarQuerySchema = z
  .object({
    from: Instant,
    to: Instant,
    assigneeId: z.union([z.literal('me'), z.string().uuid()]).optional(),
  })
  .superRefine((v, ctx) => {
    const span = Date.parse(v.to) - Date.parse(v.from);
    if (!(span > 0)) ctx.addIssue({ code: 'custom', message: 'بازه زمانی نامعتبر است' });
    else if (span > MAX_CALENDAR_DAYS * 86_400_000) {
      ctx.addIssue({
        code: 'custom',
        message: `بازه تقویم حداکثر ${MAX_CALENDAR_DAYS} روز است`,
      });
    }
  });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

export const TimelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Return items strictly older than this instant. */
  before: Instant.optional(),
});
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

export interface ActivityDto {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  priority: ActivityPriority;
  title: string;
  description: string | null;
  dueAt: string | null;
  endAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  remindAt: string | null;
  reminderDismissed: boolean;
  /** PLANNED and past its due time (computed at read time). */
  overdue: boolean;
  assignee: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type TimelineItemDto =
  | { kind: 'activity'; id: string; occurredAt: string; activity: ActivityDto }
  | {
      kind: 'deal_stage';
      id: string;
      occurredAt: string;
      deal: { id: string; title: string };
      fromStage: string | null;
      toStage: string;
      actor: { id: string; name: string } | null;
    };

export interface TimelinePageDto {
  items: TimelineItemDto[];
  /** Pass as `before` to load older items; null when exhausted. */
  nextBefore: string | null;
}

export interface CalendarDto {
  items: ActivityDto[];
  /** True when the window held more activities than one response carries. */
  truncated: boolean;
}
