import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/common/rate-limiter';
import { clearSessionCookie, parseCookies, sessionCookie } from '../src/common/cookies';
import { CryptoService } from '../src/modules/auth/crypto.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { TotpService, base32Decode, base32Encode } from '../src/modules/auth/totp.service';
import { loadConfig } from '../src/config';
import { TEST_ENV } from './helpers';

describe('TOTP (RFC 6238 vectors, SHA-1, last 6 digits)', () => {
  const totp = new TotpService();
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];
  it.each(vectors)('code at t=%i is %s', (t, expected) => {
    expect(totp.codeAt(secret, t * 1000)).toBe(expected);
  });
  it('accepts ±1 step drift but not more', () => {
    const now = 1_700_000_000_000;
    const code = totp.codeAt(secret, now);
    expect(totp.verify(secret, code, now + 30_000)).toBe(true);
    expect(totp.verify(secret, code, now + 90_000)).toBe(false);
    expect(totp.verify(secret, 'abcdef', now)).toBe(false);
  });
  it('base32 round-trips', () => {
    const buf = Buffer.from([1, 2, 3, 250, 251, 252, 0, 9]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
});

describe('CryptoService', () => {
  const crypto = new CryptoService(loadConfig({ ...TEST_ENV, DATABASE_URL: 'x' }));
  it('round-trips and uses a fresh IV each time', () => {
    const a = crypto.encrypt('secret');
    const b = crypto.encrypt('secret');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe('secret');
  });
  it('detects tampering', () => {
    const [iv, tag, enc] = crypto.encrypt('secret').split('.');
    const tampered = [iv, tag, Buffer.from('xx').toString('base64') + enc].join('.');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });
});

describe('PasswordService', () => {
  const svc = new PasswordService();
  it('hashes with argon2id and verifies', async () => {
    const h = await svc.hash('correct horse battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await svc.verify(h, 'correct horse battery')).toBe(true);
    expect(await svc.verify(h, 'wrong')).toBe(false);
    expect(await svc.verify('not-a-hash', 'x')).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('blocks after max hits within the window and resets afterwards', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect([rl.allow('a'), rl.allow('a'), rl.allow('a')]).toEqual([true, true, false]);
    expect(rl.allow('b')).toBe(true);
    t = 1001;
    expect(rl.allow('a')).toBe(true);
  });
});

describe('cookies', () => {
  it('parses and builds the session cookie with safe attributes', () => {
    expect(parseCookies('a=1; ishan_sid=tok%20en; b=2')).toMatchObject({ ishan_sid: 'tok en' });
    const c = sessionCookie('abc', 60, true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
  });
});
