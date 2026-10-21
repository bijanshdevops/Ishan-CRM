import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import {
  EMAIL_HOURLY_CAP_PER_USER,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_TIMEOUT_MS,
  emailRetryDelayMinutes,
} from '@ishan/contracts';
import type { AppConfig } from '../config';
import type { PrismaService } from '../infra/prisma.service';
import type { QueueService } from '../infra/queue/queue.service';
import { EMAIL_JOBS, QUEUES } from '../infra/queue/queues';
import { buildNotificationEmail } from '../modules/notifications/email-message';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const LEASE_MS = 2 * MINUTE_MS;
const SWEEP_BATCH = 200;
const MAX_ERROR_LENGTH = 500;

type Logger = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}
export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

/** True when the e-mail channel is configured at all. */
export const emailChannelEnabled = (c: Pick<AppConfig, 'SMTP_HOST'>) => Boolean(c.SMTP_HOST);

/** STARTTLS (or implicit TLS) is mandatory; plain SMTP only for dev/test and never in production. */
export function createSmtpTransport(c: AppConfig): MailTransport {
  const plain = c.SMTP_ALLOW_INSECURE && c.NODE_ENV !== 'production';
  return nodemailer.createTransport({
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    secure: c.SMTP_SECURE,
    requireTLS: !c.SMTP_SECURE && !plain,
    ignoreTLS: !c.SMTP_SECURE && plain,
    auth: c.SMTP_USER && c.SMTP_PASSWORD ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD } : undefined,
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS,
  }) as unknown as MailTransport;
}

/** Hands delivery ids to the `emails` queue. A duplicate add (same id and attempt) is ignored. */
export async function publishEmails(
  queues: QueueService,
  items: Array<{ id: string; attempt: number }>,
): Promise<void> {
  const queue = queues.queue(QUEUES.emails);
  if (!queue || items.length === 0) return;
  await queue.addBulk(
    items.map((i) => ({
      name: EMAIL_JOBS.send,
      data: { deliveryId: i.id },
      opts: {
        jobId: `${i.id}_${i.attempt}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    })),
  );
}

export interface EmailDeps {
  prisma: Pick<PrismaService, 'emailDelivery'>;
  transport: MailTransport;
  config: Pick<AppConfig, 'EMAIL_FROM' | 'APP_BASE_URL'>;
  now?: () => Date;
  log?: Logger;
}

export type EmailOutcome = 'sent' | 'retry' | 'failed' | 'skipped' | 'not-due';

/** Message for the delivery log: never includes credentials, one line, capped. */
const describeError = (e: unknown) =>
  String((e as { message?: string })?.message ?? e)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, MAX_ERROR_LENGTH);

/** 5xx replies from the server (bad mailbox, policy) will not get better on retry. */
const isPermanent = (e: unknown) => {
  const code = (e as { responseCode?: number })?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
};

export async function sendEmailDelivery(deps: EmailDeps, id: string): Promise<EmailOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  // Claim: only one worker may take a due row; the lease keeps it from being re-queued meanwhile.
  const claimed = await deps.prisma.emailDelivery.updateMany({
    where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) return 'not-due';
  const row = await deps.prisma.emailDelivery.findUnique({
    where: { id },
    select: {
      attempt: true,
      userId: true,
      notification: {
        select: { title: true, body: true, entityType: true, entityId: true },
      },
      user: {
        select: {
          email: true,
          status: true,
          deletedAt: true,
          notificationPreference: { select: { emailEnabled: true } },
        },
      },
    },
  });
  if (!row) return 'not-due';

  const skip = async (reason: string): Promise<EmailOutcome> => {
    await deps.prisma.emailDelivery.update({
      where: { id },
      data: { status: 'SKIPPED', nextAttemptAt: null, lastError: reason },
    });
    return 'skipped';
  };

  if (
    row.user.status !== 'ACTIVE' ||
    row.user.deletedAt ||
    !row.user.notificationPreference?.emailEnabled
  ) {
    return skip('recipient is not eligible');
  }
  const sentLastHour = await deps.prisma.emailDelivery.count({
    where: {
      userId: row.userId,
      status: 'SENT',
      sentAt: { gt: new Date(now.getTime() - 60 * MINUTE_MS) },
    },
  });
  if (sentLastHour >= EMAIL_HOURLY_CAP_PER_USER) return skip('hourly limit reached');

  const built = buildNotificationEmail(row.notification, deps.config.APP_BASE_URL ?? '');
  const attempt = row.attempt + 1;
  try {
    await deps.transport.sendMail({
      from: deps.config.EMAIL_FROM ?? '',
      to: row.user.email,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
  } catch (e) {
    const delay = isPermanent(e) ? null : emailRetryDelayMinutes(attempt);
    const finished = delay === null || attempt >= EMAIL_MAX_ATTEMPTS;
    await deps.prisma.emailDelivery.update({
      where: { id },
      data: {
        attempt,
        status: finished ? 'FAILED' : 'PENDING',
        nextAttemptAt: finished ? null : new Date(now.getTime() + (delay ?? 0) * MINUTE_MS),
        lastError: describeError(e),
      },
    });
    deps.log?.error({ deliveryId: id, attempt, final: finished }, 'email send failed');
    return finished ? 'failed' : 'retry';
  }
  await deps.prisma.emailDelivery.update({
    where: { id },
    data: { attempt, status: 'SENT', nextAttemptAt: null, sentAt: now, lastError: null },
  });
  return 'sent';
}

/** Processor of the `emails` queue. */
export function createEmailProcessor(deps: EmailDeps) {
  return async (job: Job): Promise<{ outcome: EmailOutcome }> => {
    if (job.name !== EMAIL_JOBS.send) throw new Error(`Unknown email job: ${job.name}`);
    const { deliveryId } = job.data as { deliveryId?: string };
    if (!deliveryId) throw new Error('send-email needs a deliveryId');
    return { outcome: await sendEmailDelivery(deps, deliveryId) };
  };
}

/** Deliveries whose time has come (first attempt, a retry, or an expired lease). */
export async function findDueEmails(
  prisma: Pick<PrismaService, 'emailDelivery'>,
  now: Date,
): Promise<Array<{ id: string; attempt: number }>> {
  return prisma.emailDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true, attempt: true },
  });
}

/** Deletes finished deliveries older than `retentionDays`. Pending ones are never purged. */
export async function purgeEmailDeliveries(
  prisma: Pick<PrismaService, 'emailDelivery'>,
  now: Date,
  retentionDays: number,
): Promise<number> {
  const res = await prisma.emailDelivery.deleteMany({
    where: {
      status: { in: ['SENT', 'FAILED', 'SKIPPED'] },
      createdAt: { lt: new Date(now.getTime() - retentionDays * DAY_MS) },
    },
  });
  return res.count;
}
