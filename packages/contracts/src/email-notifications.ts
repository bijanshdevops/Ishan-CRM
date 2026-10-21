import { z } from 'zod';

/** E-mail channel for notifications (ADR 0013). */

/** Total attempts per e-mail. */
export const EMAIL_MAX_ATTEMPTS = 5;
/** Minutes to wait after failed attempt N (1-based) before attempt N+1. */
export const EMAIL_BACKOFF_MINUTES = [1, 10, 60, 360] as const;
/** E-mails sent to one user per rolling hour; the rest are skipped (the in-app notification stays). */
export const EMAIL_HOURLY_CAP_PER_USER = 30;
/** Test e-mails one user may request per hour. */
export const EMAIL_TEST_PER_HOUR = 5;
export const EMAIL_TIMEOUT_MS = 15_000;

export const EMAIL_DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

/** Delay before the next attempt after `attempt` (1-based) failed; `null` = give up. */
export function emailRetryDelayMinutes(attempt: number): number | null {
  if (attempt >= EMAIL_MAX_ATTEMPTS) return null;
  return EMAIL_BACKOFF_MINUTES[attempt - 1] ?? null;
}

export const UpdateNotificationPreferencesSchema = z.strictObject({ emailEnabled: z.boolean() });
export type UpdateNotificationPreferences = z.infer<typeof UpdateNotificationPreferencesSchema>;

export interface NotificationPreferencesDto {
  /** `false` when the server has no SMTP configured; the switch is then hidden and cannot be turned on. */
  emailAvailable: boolean;
  emailEnabled: boolean;
  /** The user's own address, where e-mails would go (never editable here). */
  email: string;
}
