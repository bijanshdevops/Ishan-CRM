import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Redis for queues. Optional: without it the API serves traffic and no jobs are scheduled. */
  REDIS_URL: z.string().url().optional(),
  /** Port of the worker's own health endpoint (the worker has no public HTTP surface). */
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  /** Expired or revoked sessions are kept this long before the maintenance job deletes them. */
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Dispatched domain events are kept this long (ADR 0011). */
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(730).default(90),
  WORKFLOW_RUN_RETENTION_DAYS: z.coerce.number().int().min(1).max(730).default(90),
  /** Webhook deliveries (finished ones) are kept this long (ADR 0012). */
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Dev/test only: allow http://localhost webhook targets. Ignored in production. */
  WEBHOOK_ALLOW_INSECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** E-mail channel (ADR 0013). Without SMTP_HOST the channel is off and nothing is queued. */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** true = implicit TLS (port 465); false = STARTTLS is required. */
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  /** Dev/test only: allow a plain-text SMTP session. Ignored in production. */
  SMTP_ALLOW_INSECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  EMAIL_FROM: z.string().min(3).optional(),
  /** Public base URL of the web app; used for the link in e-mails. */
  APP_BASE_URL: z.string().url().optional(),
  /** Marketing sender (ADR 0015); defaults to EMAIL_FROM. */
  CAMPAIGN_EMAIL_FROM: z.string().min(3).optional(),
  CAMPAIGN_EMAIL_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),
  CAMPAIGN_RECIPIENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(730).default(180),
  /** Headless Chromium used to render quote PDFs (ADR 0016). Without it the PDF feature is off. */
  PDF_CHROMIUM_PATH: z.string().min(1).optional(),
  EMAIL_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  APP_VERSION: z.string().default('0.1.0'),
  /** Base64-encoded 32-byte key (AES-256-GCM) for secrets at rest, e.g. TOTP seeds. */
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of exactly 32 bytes'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .default(480),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  BOOTSTRAP_ORG_NAME: z.string().min(1).default('سازمان من'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
});

const checked = EnvSchema.superRefine((c, ctx) => {
  if (!c.SMTP_HOST) return;
  for (const key of ['EMAIL_FROM', 'APP_BASE_URL'] as const) {
    if (!c[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: `is required when SMTP_HOST is set` });
    }
  }
  if (Boolean(c.SMTP_USER) !== Boolean(c.SMTP_PASSWORD)) {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_PASSWORD'],
      message: 'SMTP_USER and SMTP_PASSWORD must be set together',
    });
  }
});

export type AppConfig = z.infer<typeof checked>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = checked.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
