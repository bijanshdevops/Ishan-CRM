/** Queue and job names are part of the contract between the API (producer) and the worker. */
export const QUEUES = {
  maintenance: 'maintenance',
  events: 'events',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const MAINTENANCE_JOBS = {
  purgeExpiredSessions: 'purge-expired-sessions',
  sweepUndispatchedEvents: 'sweep-undispatched-events',
  scanTimeEvents: 'scan-time-events',
  purgeDispatchedEvents: 'purge-dispatched-events',
} as const;

export const EVENT_JOBS = {
  dispatch: 'dispatch-event',
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
];
