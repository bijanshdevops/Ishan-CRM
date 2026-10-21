import { z } from 'zod';

export const NOTIFICATION_TYPES = ['workflow', 'system'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TITLE_MAX = 200;
export const NOTIFICATION_BODY_MAX = 1000;
/** Entities a notification may link to; the UI maps each to a route. */
export const NOTIFICATION_ENTITY_TYPES = [
  'customer',
  'lead',
  'deal',
  'quote',
  'contract',
  'activity',
] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

export const NotificationListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export interface UnreadCountDto {
  count: number;
}
