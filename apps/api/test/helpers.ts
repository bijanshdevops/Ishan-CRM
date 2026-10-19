export const TEST_ENV = {
  NODE_ENV: 'test',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CORS_ORIGINS: 'http://localhost:3000',
  BOOTSTRAP_ADMIN_EMAIL: 'admin-test@example.com',
  BOOTSTRAP_ADMIN_PASSWORD: 'Initial-Passw0rd-Test',
  LOGIN_MAX_FAILURES: '5',
  LOG_LEVEL: 'fatal',
} as const;

export function applyTestEnv(extra: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...extra })) process.env[k] = v;
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
}
