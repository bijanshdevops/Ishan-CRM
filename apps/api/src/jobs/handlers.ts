import type { PrismaService } from '../infra/prisma.service';
import type { EventHandler } from './events';
import { createWorkflowHandler } from './workflow-engine';

/**
 * Everything that reacts to a dispatched domain event (ADR 0011). Each handler must be
 * idempotent: a retry re-runs every handler for the same event.
 */
export function createEventHandlers(
  prisma: PrismaService,
  log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
): EventHandler[] {
  return [createWorkflowHandler({ prisma, log })];
}
