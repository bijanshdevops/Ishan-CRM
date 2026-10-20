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
export function assertIfMatch(ifMatch: string | undefined, current: Date): void {
  if (ifMatch === undefined || ifMatch.trim() === '' || ifMatch.trim() === '*') return;
  const supplied = ifMatch
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .filter(Boolean);
  if (!supplied.includes(etagOf(current))) {
    throw new HttpException(
      {
        code: 'STALE_ENTITY',
        message:
          'این رکورد در این فاصله توسط شخص دیگری تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.',
      },
      HttpStatus.PRECONDITION_FAILED,
    );
  }
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
