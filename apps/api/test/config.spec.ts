import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('applies defaults and parses CORS origins', () => {
    const cfg = loadConfig({
      DATABASE_URL: 'postgresql://x',
      CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(cfg.PORT).toBe(4000);
    expect(cfg.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });
  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
