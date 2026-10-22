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
  describe('production safety', () => {
    const prod = { ...TEST_ENV, DATABASE_URL: 'x', NODE_ENV: 'production', TRUST_PROXY: '1' };
    it('requires TRUST_PROXY', () => {
      expect(() => loadConfig({ ...prod, TRUST_PROXY: undefined })).toThrow(/TRUST_PROXY/);
    });
    it('parses TRUST_PROXY forms', () => {
      expect(loadConfig(prod).TRUST_PROXY).toBe(1);
      expect(loadConfig({ ...prod, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
      expect(loadConfig({ ...prod, TRUST_PROXY: '10.0.0.0/8' }).TRUST_PROXY).toBe('10.0.0.0/8');
    });
    it('allows the dev key only with ALLOW_DEV_SECRETS', () => {
      const dev = { ...prod, ENCRYPTION_KEY: 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM=' };
      expect(() => loadConfig({ ...dev, ALLOW_DEV_SECRETS: 'true' })).not.toThrow();
    });
    it('rejects the public development key and admin password', () => {
      expect(() =>
        loadConfig({ ...prod, ENCRYPTION_KEY: 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM=' }),
      ).toThrow(/ENCRYPTION_KEY/);
      expect(() => loadConfig({ ...prod, BOOTSTRAP_ADMIN_PASSWORD: 'ChangeMe-Dev-2026!' })).toThrow(
        /BOOTSTRAP_ADMIN_PASSWORD/,
      );
    });
  });
});
