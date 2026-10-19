import { z } from 'zod';

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), z.enum(['up', 'down'])),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
