import type { Job } from 'bullmq';
import type { PrismaService } from '../infra/prisma.service';
import { MAINTENANCE_JOBS } from '../infra/queue/queues';
import { findUndispatchedEventIds, purgeDispatchedEvents, scanTimeEvents } from './events';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes sessions that can no longer authenticate and have been dead for `retentionDays`:
 * idle-expired, absolutely expired or revoked. Live sessions are never touched.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredSessions(
  prisma: Pick<PrismaService, 'session'>,
  now: Date,
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const res = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: cutoff } },
        { absoluteExpiresAt: { lt: cutoff } },
        { revokedAt: { lt: cutoff } },
      ],
    },
  });
  return res.count;
}

export interface MaintenanceDeps {
  prisma: Pick<PrismaService, 'session' | 'activity' | 'contract' | 'domainEvent'>;
  retentionDays: number;
  eventRetentionDays: number;
  /** Hands event ids to the `events` queue (see DomainEventsService.publish). */
  publishEvents: (ids: string[]) => Promise<void>;
  now?: () => Date;
  log?: { info: (obj: object, msg: string) => void };
}

/** One processor for the `maintenance` queue; unknown job names fail loudly (and are retried/inspected). */
export function createMaintenanceProcessor(deps: MaintenanceDeps) {
  const now = () => (deps.now ?? (() => new Date()))();
  return async (job: Job): Promise<{ deleted: number; queued?: number; created?: number }> => {
    switch (job.name) {
      case MAINTENANCE_JOBS.purgeExpiredSessions: {
        const deleted = await purgeExpiredSessions(deps.prisma, now(), deps.retentionDays);
        deps.log?.info({ job: job.name, deleted }, 'maintenance job finished');
        return { deleted };
      }
      case MAINTENANCE_JOBS.sweepUndispatchedEvents: {
        const ids = await findUndispatchedEventIds(deps.prisma, now());
        await deps.publishEvents(ids);
        if (ids.length) deps.log?.info({ job: job.name, queued: ids.length }, 'swept events');
        return { deleted: 0, queued: ids.length };
      }
      case MAINTENANCE_JOBS.scanTimeEvents: {
        const created = await scanTimeEvents(deps.prisma, now());
        if (created) deps.log?.info({ job: job.name, created }, 'time-based events raised');
        return { deleted: 0, created };
      }
      case MAINTENANCE_JOBS.purgeDispatchedEvents: {
        const deleted = await purgeDispatchedEvents(deps.prisma, now(), deps.eventRetentionDays);
        deps.log?.info({ job: job.name, deleted }, 'maintenance job finished');
        return { deleted };
      }
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  };
}
