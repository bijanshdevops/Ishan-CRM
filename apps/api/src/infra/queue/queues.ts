/** Queue and job names are part of the contract between the API (producer) and the worker. */
export const QUEUES = {
  maintenance: 'maintenance',
  events: 'events',
  webhooks: 'webhooks',
  emails: 'emails',
  campaignEmails: 'campaign-emails',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const MAINTENANCE_JOBS = {
  purgeExpiredSessions: 'purge-expired-sessions',
  sweepUndispatchedEvents: 'sweep-undispatched-events',
  scanTimeEvents: 'scan-time-events',
  purgeDispatchedEvents: 'purge-dispatched-events',
  purgeReadNotifications: 'purge-read-notifications',
  purgeWorkflowRuns: 'purge-workflow-runs',
  sweepWebhookDeliveries: 'sweep-webhook-deliveries',
  purgeWebhookDeliveries: 'purge-webhook-deliveries',
  sweepEmailDeliveries: 'sweep-email-deliveries',
  purgeEmailDeliveries: 'purge-email-deliveries',
  purgeEmailVerificationTokens: 'purge-email-verification-tokens',
  sweepCampaignRecipients: 'sweep-campaign-recipients',
  purgeCampaignRecipients: 'purge-campaign-recipients',
} as const;

export const EVENT_JOBS = {
  dispatch: 'dispatch-event',
} as const;

export const WEBHOOK_JOBS = {
  deliver: 'deliver-webhook',
} as const;

export const EMAIL_JOBS = {
  send: 'send-email',
} as const;

export const CAMPAIGN_JOBS = {
  send: 'send-campaign-email',
} as const;

export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[keyof typeof MAINTENANCE_JOBS];

/**
 * Repeatable jobs. Cron is evaluated in UTC (time is UTC everywhere, ADR 0003);
 * 00:00 UTC is 03:30 in Tehran, the quietest hour for an office CRM.
 */
export const MAINTENANCE_SCHEDULES: ReadonlyArray<{
  id: string;
  job: MaintenanceJobName;
  pattern: string;
}> = [
  {
    id: 'daily-purge-expired-sessions',
    job: MAINTENANCE_JOBS.purgeExpiredSessions,
    pattern: '0 0 * * *',
  },
  {
    id: 'minutely-sweep-undispatched-events',
    job: MAINTENANCE_JOBS.sweepUndispatchedEvents,
    pattern: '* * * * *',
  },
  {
    id: 'quarter-hourly-scan-time-events',
    job: MAINTENANCE_JOBS.scanTimeEvents,
    pattern: '*/15 * * * *',
  },
  {
    id: 'daily-purge-dispatched-events',
    job: MAINTENANCE_JOBS.purgeDispatchedEvents,
    pattern: '10 0 * * *',
  },
  {
    id: 'daily-purge-read-notifications',
    job: MAINTENANCE_JOBS.purgeReadNotifications,
    pattern: '20 0 * * *',
  },
  {
    id: 'daily-purge-workflow-runs',
    job: MAINTENANCE_JOBS.purgeWorkflowRuns,
    pattern: '30 0 * * *',
  },
  {
    id: 'minutely-sweep-webhook-deliveries',
    job: MAINTENANCE_JOBS.sweepWebhookDeliveries,
    pattern: '* * * * *',
  },
  {
    id: 'daily-purge-webhook-deliveries',
    job: MAINTENANCE_JOBS.purgeWebhookDeliveries,
    pattern: '40 0 * * *',
  },
  {
    id: 'minutely-sweep-email-deliveries',
    job: MAINTENANCE_JOBS.sweepEmailDeliveries,
    pattern: '* * * * *',
  },
  {
    id: 'daily-purge-email-deliveries',
    job: MAINTENANCE_JOBS.purgeEmailDeliveries,
    pattern: '50 0 * * *',
  },
  {
    id: 'daily-purge-email-verification-tokens',
    job: MAINTENANCE_JOBS.purgeEmailVerificationTokens,
    pattern: '55 0 * * *',
  },
  {
    id: 'minutely-sweep-campaign-recipients',
    job: MAINTENANCE_JOBS.sweepCampaignRecipients,
    pattern: '* * * * *',
  },
  {
    id: 'daily-purge-campaign-recipients',
    job: MAINTENANCE_JOBS.purgeCampaignRecipients,
    pattern: '5 1 * * *',
  },
];
