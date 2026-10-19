import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { TEST_ENV } from './helpers';

describe('loadConfig', () => {
  it('applies defaults and parses CORS origins', () => {
    const cfg = loadConfig({
      ...TEST_ENV,
      DATABASE_URL: 'postgresql://x',
      CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(cfg.PORT).toBe(4000);
    expect(cfg.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });
  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ ...TEST_ENV })).toThrow(/DATABASE_URL/);
  });
  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      loadConfig({ ...TEST_ENV, DATABASE_URL: 'x', ENCRYPTION_KEY: 'c2hvcnQ=' }),
    ).toThrow(/ENCRYPTION_KEY/);
  });
});
