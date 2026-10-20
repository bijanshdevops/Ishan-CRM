import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'fa-IR',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
