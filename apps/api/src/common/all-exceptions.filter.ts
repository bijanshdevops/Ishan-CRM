import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError } from '@ishan/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Maps every thrown error to the shared ApiError body; never leaks internals on 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let code: string | undefined;
    let details: unknown;
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message = typeof body.message === 'string' ? body.message : exception.message;
        if (Array.isArray(body.message)) details = body.message;
        if (body.details !== undefined) details = body.details;
        if (typeof body.code === 'string') code = body.code;
      }
    }

    const payload: ApiError = {
      error: {
        code: code ?? HttpStatus[status] ?? 'ERROR',
        message: status >= 500 ? 'Internal server error' : message,
        ...(details !== undefined && status < 500 ? { details } : {}),
        traceId: String(request.id),
      },
    };

    if (status >= 500) request.log.error({ err: exception }, 'unhandled exception');
    void reply.status(status).send(payload);
  }
}
