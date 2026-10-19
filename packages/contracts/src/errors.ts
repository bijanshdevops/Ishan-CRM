import { z } from 'zod';

/** Error body shape (aligned with RFC 9457 problem details). */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    traceId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
