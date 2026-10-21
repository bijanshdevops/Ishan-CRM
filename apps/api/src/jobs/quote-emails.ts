import {
  EMAIL_MAX_ATTEMPTS,
  QUOTE_EMAILABLE_STATUSES,
  emailRetryDelayMinutes,
} from '@ishan/contracts';
import type { Job } from 'bullmq';
import type { AppConfig } from '../config';
import type { QueueService } from '../infra/queue/queue.service';
import { EMAIL_JOBS, QUEUES } from '../infra/queue/queues';
import type { PrismaService } from '../infra/prisma.service';
import { quoteInclude, toQuoteDto } from '../modules/quotes/mappers';
import type { PdfRenderer } from '../modules/quotes/pdf-renderer';
import { buildQuoteEmail } from '../modules/quotes/quote-email-message';
import { buildQuoteHtml, quotePdfFilename, vazirmatnFontCss } from '../modules/quotes/quote-pdf';
import type { MailTransport } from './emails';

const MINUTE_MS = 60_000;
const LEASE_MS = 5 * MINUTE_MS;
const SWEEP_BATCH = 100;
const MAX_ERROR_LENGTH = 500;

type Logger = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

export interface QuoteEmailDeps {
  prisma: Pick<PrismaService, 'quoteEmail' | 'quote' | 'organization'>;
  transport: MailTransport;
  renderer: Pick<PdfRenderer, 'render' | 'available'>;
  config: Pick<AppConfig, 'EMAIL_FROM' | 'APP_BASE_URL'>;
  now?: () => Date;
  log?: Logger;
}

export type QuoteEmailOutcome = 'sent' | 'retry' | 'failed' | 'not-due';

const describeError = (e: unknown) =>
  String((e as { message?: string })?.message ?? e)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, MAX_ERROR_LENGTH);

const isPermanent = (e: unknown) => {
  const code = (e as { responseCode?: number })?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
};

/** Sends one queued quote e-mail: claim, render the PDF now, deliver, record the outcome. */
export async function sendQuoteEmail(deps: QuoteEmailDeps, id: string): Promise<QuoteEmailOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await deps.prisma.quoteEmail.updateMany({
    where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) return 'not-due';
  const row = await deps.prisma.quoteEmail.findUniqueOrThrow({
    where: { id },
    select: {
      attempt: true,
      organizationId: true,
      quoteId: true,
      toEmail: true,
      replyTo: true,
      message: true,
      sender: { select: { name: true } },
    },
  });
  const attempt = row.attempt + 1;

  const fail = async (e: unknown, permanent: boolean): Promise<QuoteEmailOutcome> => {
    const delay = permanent ? null : emailRetryDelayMinutes(attempt);
    const finished = delay === null || attempt >= EMAIL_MAX_ATTEMPTS;
    await deps.prisma.quoteEmail.update({
      where: { id },
      data: {
        attempt,
        status: finished ? 'FAILED' : 'PENDING',
        nextAttemptAt: finished ? null : new Date(now.getTime() + (delay ?? 0) * MINUTE_MS),
        lastError: describeError(e),
      },
    });
    deps.log?.error({ quoteEmailId: id, attempt, final: finished }, 'quote email failed');
    return finished ? 'failed' : 'retry';
  };

  try {
    const q = await deps.prisma.quote.findFirst({
      where: { id: row.quoteId, organizationId: row.organizationId, deletedAt: null },
      include: quoteInclude,
    });
    if (!q || !(QUOTE_EMAILABLE_STATUSES as readonly string[]).includes(q.status)) {
      return await fail(new Error('quote can no longer be e-mailed'), true);
    }
    const org = await deps.prisma.organization.findUniqueOrThrow({
      where: { id: row.organizationId },
      select: { name: true },
    });
    const dto = toQuoteDto(q, q.version);
    const pdf = await deps.renderer.render(buildQuoteHtml(dto, org.name, vazirmatnFontCss()));
    const mail = buildQuoteEmail({
      quote: dto,
      organizationName: org.name,
      senderName: row.sender?.name ?? org.name,
      message: row.message,
    });
    await deps.transport.sendMail({
      from: deps.config.EMAIL_FROM ?? '',
      to: row.toEmail,
      replyTo: row.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        { filename: quotePdfFilename(dto), content: pdf, contentType: 'application/pdf' },
      ],
      headers: { 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
    });
  } catch (e) {
    return fail(e, isPermanent(e));
  }
  await deps.prisma.quoteEmail.update({
    where: { id },
    data: { attempt, status: 'SENT', nextAttemptAt: null, sentAt: now, lastError: null },
  });
  return 'sent';
}

export async function findDueQuoteEmails(
  prisma: Pick<PrismaService, 'quoteEmail'>,
  now: Date,
): Promise<Array<{ id: string; attempt: number }>> {
  return prisma.quoteEmail.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true, attempt: true },
  });
}

/** Hands quote e-mail ids to the `emails` queue; a duplicate add (same id and attempt) is ignored. */
export async function publishQuoteEmails(
  queues: QueueService,
  items: Array<{ id: string; attempt: number }>,
): Promise<void> {
  const queue = queues.queue(QUEUES.emails);
  if (!queue || items.length === 0) return;
  await queue.addBulk(
    items.map((i) => ({
      name: EMAIL_JOBS.sendQuote,
      data: { quoteEmailId: i.id },
      opts: {
        jobId: `qe_${i.id}_${i.attempt}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    })),
  );
}

/** Processor for the quote e-mail jobs on the `emails` queue. */
export function createQuoteEmailProcessor(deps: QuoteEmailDeps) {
  return async (job: Job): Promise<{ outcome: QuoteEmailOutcome }> => {
    const { quoteEmailId } = job.data as { quoteEmailId?: string };
    if (!quoteEmailId) throw new Error('send-quote-email needs a quoteEmailId');
    return { outcome: await sendQuoteEmail(deps, quoteEmailId) };
  };
}
