import type { Job } from 'bullmq';
import type { PrismaService } from '../infra/prisma.service';
import { MAINTENANCE_JOBS } from '../infra/queue/queues';

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
  prisma: Pick<PrismaService, 'session'>;
  retentionDays: number;
  now?: () => Date;
  log?: { info: (obj: object, msg: string) => void };
}

/** One processor for the `maintenance` queue; unknown job names fail loudly (and are retried/inspected). */
export function createMaintenanceProcessor(deps: MaintenanceDeps) {
  return async (job: Job): Promise<{ deleted: number }> => {
    switch (job.name) {
      case MAINTENANCE_JOBS.purgeExpiredSessions: {
        const deleted = await purgeExpiredSessions(
          deps.prisma,
          (deps.now ?? (() => new Date()))(),
          deps.retentionDays,
        );
        deps.log?.info({ job: job.name, deleted }, 'maintenance job finished');
        return { deleted };
      }
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  };
}
