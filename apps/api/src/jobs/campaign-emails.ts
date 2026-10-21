import type { Job } from 'bullmq';
import { EMAIL_MAX_ATTEMPTS, emailRetryDelayMinutes } from '@ishan/contracts';
import type { AppConfig } from '../config';
import type { PrismaService } from '../infra/prisma.service';
import type { QueueService } from '../infra/queue/queue.service';
import { CAMPAIGN_JOBS, QUEUES } from '../infra/queue/queues';
import { buildCampaignEmail } from '../modules/marketing/campaign-message';
import { signUnsubscribe } from '../modules/marketing/unsubscribe-token';
import type { MailTransport } from './emails';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const LEASE_MS = 2 * MINUTE_MS;
const SWEEP_BATCH = 200;
const MAX_ERROR_LENGTH = 500;

type Logger = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

/** Hands recipient ids to the `campaign-emails` queue. A duplicate add (same id and attempt) is ignored. */
export async function publishCampaignEmails(
  queues: QueueService,
  items: Array<{ id: string; attempt: number }>,
): Promise<void> {
  const queue = queues.queue(QUEUES.campaignEmails);
  if (!queue || items.length === 0) return;
  await queue.addBulk(
    items.map((i) => ({
      name: CAMPAIGN_JOBS.send,
      data: { recipientId: i.id },
      opts: {
        jobId: `${i.id}_${i.attempt}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    })),
  );
}

export interface CampaignEmailDeps {
  prisma: Pick<
    PrismaService,
    'campaignRecipient' | 'campaignSending' | 'campaign' | 'marketingSuppression'
  >;
  transport: MailTransport;
  config: Pick<AppConfig, 'EMAIL_FROM' | 'CAMPAIGN_EMAIL_FROM' | 'APP_BASE_URL' | 'ENCRYPTION_KEY'>;
  now?: () => Date;
  log?: Logger;
}

export type CampaignEmailOutcome = 'sent' | 'retry' | 'failed' | 'skipped' | 'not-due';

const describeError = (e: unknown) =>
  String((e as { message?: string })?.message ?? e)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, MAX_ERROR_LENGTH);

const isPermanent = (e: unknown) => {
  const code = (e as { responseCode?: number })?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
};

/** "550 5.1.1 user unknown": the mailbox does not exist, so the address must not be mailed again. */
const isHardBounce = (e: unknown) =>
  (e as { responseCode?: number })?.responseCode === 550 &&
  /\b5\.1\.1\b/.test(String((e as { response?: string })?.response ?? ''));

/** Marks the send DONE (and its campaign COMPLETED) once no recipient is pending any more. */
export async function finishSendingIfDone(
  prisma: CampaignEmailDeps['prisma'],
  sendingId: string,
  now: Date,
): Promise<boolean> {
  const pending = await prisma.campaignRecipient.count({
    where: { sendingId, status: 'PENDING' },
  });
  if (pending > 0) return false;
  const done = await prisma.campaignSending.updateMany({
    where: { id: sendingId, status: 'SENDING' },
    data: { status: 'DONE', finishedAt: now },
  });
  if (done.count === 0) return false;
  const sending = await prisma.campaignSending.findUnique({
    where: { id: sendingId },
    select: { campaignId: true },
  });
  if (sending) {
    await prisma.campaign.updateMany({
      where: { id: sending.campaignId, status: 'ACTIVE' },
      data: { status: 'COMPLETED' },
    });
  }
  return true;
}

export async function sendCampaignRecipient(
  deps: CampaignEmailDeps,
  id: string,
): Promise<CampaignEmailOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await deps.prisma.campaignRecipient.updateMany({
    where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) return 'not-due';
  const row = await deps.prisma.campaignRecipient.findUnique({
    where: { id },
    select: {
      sendingId: true,
      organizationId: true,
      email: true,
      name: true,
      attempt: true,
      sending: { select: { status: true, subject: true, body: true } },
    },
  });
  if (!row) return 'not-due';

  const finish = async (
    outcome: CampaignEmailOutcome,
    data: Record<string, unknown>,
  ): Promise<CampaignEmailOutcome> => {
    await deps.prisma.campaignRecipient.update({ where: { id }, data });
    await finishSendingIfDone(deps.prisma, row.sendingId, now);
    return outcome;
  };
  const skip = (reason: string) =>
    finish('skipped', { status: 'SKIPPED', nextAttemptAt: null, lastError: reason });

  if (row.sending.status !== 'SENDING') return skip('sending is not active');
  const suppressed = await deps.prisma.marketingSuppression.findUnique({
    where: { organizationId_email: { organizationId: row.organizationId, email: row.email } },
    select: { id: true },
  });
  if (suppressed) return skip('address is suppressed');

  const base = (deps.config.APP_BASE_URL ?? '').replace(/\/+$/, '');
  const token = signUnsubscribe(deps.config.ENCRYPTION_KEY, row.organizationId, row.email);
  const built = buildCampaignEmail({
    subject: row.sending.subject,
    body: row.sending.body,
    name: row.name,
    unsubscribeUrl: `${base}/unsubscribe?token=${token}`,
  });
  const attempt = row.attempt + 1;
  try {
    await deps.transport.sendMail({
      from: deps.config.CAMPAIGN_EMAIL_FROM ?? deps.config.EMAIL_FROM ?? '',
      to: row.email,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: {
        'List-Unsubscribe': `<${base}/api/v1/public/unsubscribe?token=${token}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        Precedence: 'bulk',
        'Auto-Submitted': 'auto-generated',
      },
    });
  } catch (e) {
    const delay = isPermanent(e) ? null : emailRetryDelayMinutes(attempt);
    const finished = delay === null || attempt >= EMAIL_MAX_ATTEMPTS;
    if (isHardBounce(e)) {
      await deps.prisma.marketingSuppression
        .upsert({
          where: {
            organizationId_email: { organizationId: row.organizationId, email: row.email },
          },
          create: { organizationId: row.organizationId, email: row.email, reason: 'BOUNCED' },
          update: {},
        })
        .catch(() => undefined);
    }
    deps.log?.error({ recipientId: id, attempt, final: finished }, 'campaign email failed');
    return finish(finished ? 'failed' : 'retry', {
      attempt,
      status: finished ? 'FAILED' : 'PENDING',
      nextAttemptAt: finished ? null : new Date(now.getTime() + (delay ?? 0) * MINUTE_MS),
      lastError: describeError(e),
    });
  }
  return finish('sent', {
    attempt,
    status: 'SENT',
    nextAttemptAt: null,
    sentAt: now,
    lastError: null,
  });
}

export function createCampaignEmailProcessor(deps: CampaignEmailDeps) {
  return async (job: Job): Promise<{ outcome: CampaignEmailOutcome }> => {
    if (job.name !== CAMPAIGN_JOBS.send) throw new Error(`Unknown campaign job: ${job.name}`);
    const { recipientId } = job.data as { recipientId?: string };
    if (!recipientId) throw new Error('send-campaign-email needs a recipientId');
    return { outcome: await sendCampaignRecipient(deps, recipientId) };
  };
}

/** Recipients whose time has come (first attempt, a retry, or an expired lease). */
export async function findDueCampaignRecipients(
  prisma: Pick<PrismaService, 'campaignRecipient'>,
  now: Date,
): Promise<Array<{ id: string; attempt: number }>> {
  return prisma.campaignRecipient.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true, attempt: true },
  });
}

/** Closes sends whose last recipient finished while no worker was around to notice. */
export async function finishStalledSendings(
  prisma: CampaignEmailDeps['prisma'],
  now: Date,
): Promise<number> {
  const open = await prisma.campaignSending.findMany({
    where: { status: 'SENDING' },
    select: { id: true },
    take: 50,
  });
  let closed = 0;
  for (const s of open) if (await finishSendingIfDone(prisma, s.id, now)) closed += 1;
  return closed;
}

/** Deletes finished recipient rows (the copied addresses) older than `retentionDays`. */
export async function purgeCampaignRecipients(
  prisma: Pick<PrismaService, 'campaignRecipient'>,
  now: Date,
  retentionDays: number,
): Promise<number> {
  const res = await prisma.campaignRecipient.deleteMany({
    where: {
      status: { in: ['SENT', 'FAILED', 'SKIPPED'] },
      createdAt: { lt: new Date(now.getTime() - retentionDays * DAY_MS) },
    },
  });
  return res.count;
}
