import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map, type Observable } from 'rxjs';

/** Strong validator derived from the row's `updated_at` (UTC, millisecond precision). */
export function etagOf(updatedAt: Date | string): string {
  return `"${new Date(updatedAt).getTime()}"`;
}

/**
 * Optimistic concurrency for PATCH. `If-Match` is optional (clients that do not send it keep
 * last-write-wins); when present it must equal the current ETag or the write is refused with 412,
 * so a stale form can never silently overwrite someone else's change.
 */
/** True when the client sent a concrete tag (absent, empty and `*` mean "no precondition"). */
export function hasPrecondition(ifMatch: string | undefined): ifMatch is string {
  return ifMatch !== undefined && ifMatch.trim() !== '' && ifMatch.trim() !== '*';
}

export function assertIfMatch(ifMatch: string | undefined, current: Date): void {
  if (!hasPrecondition(ifMatch)) return;
  const supplied = ifMatch
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .filter(Boolean);
  if (!supplied.includes(etagOf(current))) throw staleEntity();
}

/** 412 STALE_ENTITY, shared by the early check and the atomic write guard. */
export function staleEntity(): HttpException {
  return new HttpException(
    {
      code: 'STALE_ENTITY',
      message:
        'این رکورد در این فاصله توسط شخص دیگری تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.',
    },
    HttpStatus.PRECONDITION_FAILED,
  );
}

/**
 * Compare-and-set condition for the UPDATE itself. A one-millisecond window absorbs the
 * microseconds PostgreSQL may hold beyond what a JS Date can carry, so rows written by raw SQL
 * (migrations, seeds) still match.
 */
export function unchangedSince(updatedAt: Date): { updatedAt: { gte: Date; lt: Date } } {
  return { updatedAt: { gte: updatedAt, lt: new Date(updatedAt.getTime() + 1) } };
}

/** WHERE for a guarded UPDATE: with a concrete tag the row must still be the one the client saw. */
export function casWhere(
  id: string,
  ifMatch: string | undefined,
  seen: Date,
): { id: string; updatedAt?: { gte: Date; lt: Date } } {
  return { id, ...(hasPrecondition(ifMatch) ? unchangedSince(seen) : {}) };
}

/** Zero affected rows: 412 when a precondition was sent, otherwise the row vanished (404). */
export function assertWritten(
  count: number,
  ifMatch: string | undefined,
  gone: HttpException,
): void {
  if (count === 0) throw hasPrecondition(ifMatch) ? staleEntity() : gone;
}

/** Adds `ETag` to every single-entity response that carries an `id` and an `updatedAt`. */
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          const b = body as { id?: unknown; updatedAt?: unknown };
          if (typeof b.id === 'string' && typeof b.updatedAt === 'string') {
            context.switchToHttp().getResponse<FastifyReply>().header('ETag', etagOf(b.updatedAt));
          }
        }
        return body;
      }),
    );
  }
}
