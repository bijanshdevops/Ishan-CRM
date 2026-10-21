import { Injectable, Logger } from '@nestjs/common';
import {
  DOMAIN_EVENT_PAYLOADS,
  MAX_EVENT_PAYLOAD_BYTES,
  type DomainEventPayload,
  type DomainEventType,
} from '@ishan/contracts';
import { QueueService } from '../../infra/queue/queue.service';
import { EVENT_JOBS, QUEUES } from '../../infra/queue/queues';

export interface EventInput<T extends DomainEventType> {
  organizationId: string;
  type: T;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  payload: DomainEventPayload<T>;
  dedupeKey?: string;
  causedByRunId?: string;
}

/** Anything that can insert a row: the PrismaService itself or an interactive transaction client. */
export interface EventWriter {
  domainEvent: { create(args: { data: any }): Promise<{ id: string }> };
}

/** Validates and builds the row. Throws on a payload that violates the catalog (a programming error). */
export function buildEventRow<T extends DomainEventType>(input: EventInput<T>) {
  const payload = DOMAIN_EVENT_PAYLOADS[input.type].parse(input.payload);
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_EVENT_PAYLOAD_BYTES) {
    throw new Error(`Event payload for ${input.type} exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes`);
  }
  return {
    organizationId: input.organizationId,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId ?? null,
    payload,
    dedupeKey: input.dedupeKey ?? null,
    causedByRunId: input.causedByRunId ?? null,
  };
}

/** Puts event ids on the `events` queue (jobId = event id, so a duplicate add is ignored). */
export async function publishEventIds(queues: QueueService, ids: string[]): Promise<void> {
  const queue = queues.queue(QUEUES.events);
  if (!queue || ids.length === 0) return;
  await queue.addBulk(
    ids.map((id) => ({
      name: EVENT_JOBS.dispatch,
      data: { eventId: id },
      opts: {
        jobId: id,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 5,
        backoff: { type: 'exponential' as const, delay: 5_000 },
      },
    })),
  );
}

/**
 * Outbox writer (ADR 0011). `emit` inserts the event with the caller's client, so inside a
 * transaction it commits or rolls back together with the business change. `publish` then hands
 * the ids to the worker queue; if that fails (Redis down) nothing is lost because the sweeper job
 * re-queues events that stay undispatched.
 */
@Injectable()
export class DomainEventsService {
  private readonly log = new Logger(DomainEventsService.name);

  constructor(private readonly queues: QueueService) {}

  async emit<T extends DomainEventType>(db: EventWriter, input: EventInput<T>): Promise<string> {
    const row = await db.domainEvent.create({ data: buildEventRow(input) });
    return row.id;
  }

  async publish(ids: string[]): Promise<void> {
    try {
      await publishEventIds(this.queues, ids);
    } catch (err) {
      this.log.warn(`could not queue ${ids.length} event(s); the sweeper will: ${String(err)}`);
    }
  }
}
