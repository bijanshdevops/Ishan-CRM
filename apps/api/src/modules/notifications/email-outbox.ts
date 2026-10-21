import type { PrismaService } from '../../infra/prisma.service';

type Db = Pick<PrismaService, 'user' | 'notificationPreference' | 'emailDelivery'>;

/**
 * Queues the e-mail copy of a notification (ADR 0013). Called in the same transaction that creates
 * the notification, so either both exist or neither does. Does nothing when the recipient has not
 * opted in or is no longer an active user. Returns whether a row was queued.
 */
export async function queueNotificationEmail(
  db: Db,
  notification: { id: string; userId: string },
  now: Date,
): Promise<boolean> {
  const pref = await db.notificationPreference.findUnique({
    where: { userId: notification.userId },
    select: { emailEnabled: true },
  });
  if (!pref?.emailEnabled) return false;
  const user = await db.user.findFirst({
    where: { id: notification.userId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (!user) return false;
  await db.emailDelivery.create({
    data: {
      notificationId: notification.id,
      userId: notification.userId,
      status: 'PENDING',
      nextAttemptAt: now,
    },
    select: { id: true },
  });
  return true;
}
