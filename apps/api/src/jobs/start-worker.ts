import { Worker } from 'bullmq';
import type { AppConfig } from '../config';
import type { PrismaService } from '../infra/prisma.service';
import type { QueueService } from '../infra/queue/queue.service';
import { EMAIL_JOBS, QUEUES } from '../infra/queue/queues';
import { publishEventIds } from '../modules/events/domain-events.service';
import { createEventsProcessor, type EventHandler } from './events';
import { createEventHandlers } from './handlers';
import { createMaintenanceProcessor } from './maintenance';
import {
  createEmailProcessor,
  createSmtpTransport,
  emailChannelEnabled,
  publishEmails,
} from './emails';
import { createQuoteEmailProcessor, publishQuoteEmails } from './quote-emails';
import { PdfRenderer } from '../modules/quotes/pdf-renderer';
import { createCampaignEmailProcessor, publishCampaignEmails } from './campaign-emails';
import { createWebhookProcessor, publishDeliveries } from './webhooks';
import { CryptoService } from '../modules/auth/crypto.service';

/** Starts the maintenance, events and webhooks workers; `stop()` drains in-flight jobs. */
export async function startWorker(
  queues: QueueService,
  prisma: PrismaService,
  config: AppConfig,
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  handlers: EventHandler[] = createEventHandlers(
    prisma,
    log,
    (items) => publishDeliveries(queues, items),
    emailChannelEnabled(config),
  ),
) {
  const maintenance = new Worker(
    QUEUES.maintenance,
    createMaintenanceProcessor({
      prisma,
      retentionDays: config.SESSION_RETENTION_DAYS,
      eventRetentionDays: config.EVENT_RETENTION_DAYS,
      notificationRetentionDays: config.NOTIFICATION_RETENTION_DAYS,
      workflowRunRetentionDays: config.WORKFLOW_RUN_RETENTION_DAYS,
      publishEvents: (ids) => publishEventIds(queues, ids),
      webhookDeliveryRetentionDays: config.WEBHOOK_DELIVERY_RETENTION_DAYS,
      emailDeliveryRetentionDays: config.EMAIL_DELIVERY_RETENTION_DAYS,
      campaignRecipientRetentionDays: config.CAMPAIGN_RECIPIENT_RETENTION_DAYS,
      publishDeliveries: (items) => publishDeliveries(queues, items),
      publishEmails: (items) => publishEmails(queues, items),
      publishQuoteEmails: (items) => publishQuoteEmails(queues, items),
      publishCampaignEmails: (items) => publishCampaignEmails(queues, items),
      log,
    }),
    { connection: queues.newConnection(), concurrency: 1 },
  );
  const events = new Worker(QUEUES.events, createEventsProcessor({ prisma, handlers, log }), {
    connection: queues.newConnection(),
    concurrency: 5,
  });
  const webhooks = new Worker(
    QUEUES.webhooks,
    createWebhookProcessor({
      prisma,
      crypto: new CryptoService(config),
      guard: { allowLocal: config.WEBHOOK_ALLOW_INSECURE && config.NODE_ENV !== 'production' },
      emailChannel: emailChannelEnabled(config),
      log,
    }),
    { connection: queues.newConnection(), concurrency: 10 },
  );
  const renderer = new PdfRenderer(config.PDF_CHROMIUM_PATH);
  const emails = emailChannelEnabled(config)
    ? (() => {
        const transport = createSmtpTransport(config);
        const notifications = createEmailProcessor({ prisma, transport, config, log });
        const quotes = createQuoteEmailProcessor({ prisma, transport, renderer, config, log });
        return new Worker(
          QUEUES.emails,
          (job) => (job.name === EMAIL_JOBS.sendQuote ? quotes(job) : notifications(job)),
          { connection: queues.newConnection(), concurrency: 3 },
        );
      })()
    : null;
  const workers = emails
    ? [maintenance, events, webhooks, emails]
    : [maintenance, events, webhooks];
  for (const w of workers) {
    w.on('failed', (job, err) =>
      log.error({ queue: w.name, job: job?.name, err: err.message }, 'job failed'),
    );
  }
  await Promise.all(workers.map((w) => w.waitUntilReady()));
  const schedules = await queues.ensureSchedules();
  log.info({ schedules }, 'worker ready');
  return {
    workers,
    isRunning: () => workers.every((w) => w.isRunning()),
    stop: async () => {
      await Promise.all(workers.map((w) => w.close()));
      await renderer.close();
    },
  };
}
