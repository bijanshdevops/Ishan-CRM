import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_MAX_ATTEMPTS,
  buildWebhookEnvelope,
  checkWebhookUrl,
  webhookRetryDelayMinutes,
} from '@ishan/contracts';
import {
  generateWebhookSecret,
  secretHint,
  signPayload,
  signatureHeader,
  verifySignature,
} from '../src/modules/webhooks/signing';
import {
  UnsafeTargetError,
  isBlockedAddress,
  resolveSafeTarget,
} from '../src/modules/webhooks/url-guard';

describe('webhook signing', () => {
  const secret = 'whsec_test-secret';
  const body = '{"id":"e1","type":"deal.created"}';

  it('is HMAC-SHA256 over "<t>.<body>" as lowercase hex', () => {
    // independent re-computation guards against accidental format changes ("t.body", hex)
    const expected = createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex');
    expect(signPayload(secret, 1_700_000_000, body)).toBe(expected);
  });

  it('verifies, and rejects a tampered body, wrong secret and stale timestamp', () => {
    const t = 1_700_000_000;
    const header = signatureHeader([secret], t, body);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature(secret, header, body, t + 10)).toBe(true);
    expect(verifySignature(secret, header, body + ' ', t + 10)).toBe(false);
    expect(verifySignature('whsec_other', header, body, t + 10)).toBe(false);
    expect(verifySignature(secret, header, body, t + 301)).toBe(false);
    expect(verifySignature(secret, 'v1=abcd', body, t)).toBe(false);
  });

  it('signs with both secrets during a rotation, so either one verifies', () => {
    const t = 1_700_000_000;
    const header = signatureHeader(['whsec_new', 'whsec_old'], t, body);
    expect(header.match(/v1=/g)).toHaveLength(2);
    expect(verifySignature('whsec_new', header, body, t)).toBe(true);
    expect(verifySignature('whsec_old', header, body, t)).toBe(true);
  });

  it('generates distinct, prefixed secrets with a 4-character hint', () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(a);
    expect(secretHint(a)).toBe(a.slice(-4));
  });
});

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.5',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows public %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  const lookup = (answers: string[]) => async () =>
    answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('pins the first public address of a name', async () => {
    const t = await resolveSafeTarget('https://hooks.example.com/in', {
      allowLocal: false,
      lookup: lookup(['93.184.216.34']),
    });
    expect(t).toMatchObject({ address: '93.184.216.34', family: 4 });
  });

  it('rejects a name when ANY answer is private (split-horizon / rebinding)', async () => {
    await expect(
      resolveSafeTarget('https://evil.example.com/', {
        allowLocal: false,
        lookup: lookup(['93.184.216.34', '10.0.0.5']),
      }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
  });

  it('rejects literal private IPs, bad schemes and credentials', async () => {
    for (const u of [
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/',
      'https://[::ffff:127.0.0.1]/',
      'http://example.com/',
      'ftp://example.com/',
      'https://user:pw@example.com/',
      'not a url',
    ]) {
      await expect(
        resolveSafeTarget(u, { allowLocal: false, lookup: lookup(['93.184.216.34']) }),
      ).rejects.toBeInstanceOf(UnsafeTargetError);
    }
  });

  it('allows http://localhost only when allowLocal is on', async () => {
    await expect(
      resolveSafeTarget('http://localhost:9/x', { allowLocal: false }),
    ).rejects.toThrow();
    expect(await resolveSafeTarget('http://localhost:9/x', { allowLocal: true })).toMatchObject({
      address: '127.0.0.1',
    });
    // allowLocal never opens up other private ranges
    await expect(
      resolveSafeTarget('http://10.0.0.1/x', { allowLocal: true }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
  });

  it('reports an unresolvable name as an unsafe target, not a crash', async () => {
    await expect(
      resolveSafeTarget('https://nope.invalid/', {
        allowLocal: false,
        lookup: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
  });
});

describe('webhook contract helpers', () => {
  it('backs off 1m, 5m, 30m, 2h, 6h, 24h then gives up after 7 attempts', () => {
    expect([1, 2, 3, 4, 5, 6].map(webhookRetryDelayMinutes)).toEqual([1, 5, 30, 120, 360, 1440]);
    expect(webhookRetryDelayMinutes(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
    expect(webhookRetryDelayMinutes(WEBHOOK_MAX_ATTEMPTS + 1)).toBeNull();
  });

  it('checks URL syntax', () => {
    expect(checkWebhookUrl('https://example.com/hook?x=1')).toBeNull();
    expect(checkWebhookUrl('http://example.com/hook')).not.toBeNull();
    expect(checkWebhookUrl('http://localhost:3000/h')).not.toBeNull();
    expect(checkWebhookUrl('http://localhost:3000/h', true)).toBeNull();
    expect(checkWebhookUrl('https://a:b@example.com/')).not.toBeNull();
    expect(checkWebhookUrl('https://example.com/#frag')).not.toBeNull();
    expect(checkWebhookUrl('https://example.com/' + 'a'.repeat(2100))).not.toBeNull();
  });

  it('builds the public envelope from an event', () => {
    const occurredAt = new Date('2026-10-21T10:00:00.000Z');
    expect(
      buildWebhookEnvelope({
        id: 'e1',
        type: 'deal.created',
        organizationId: 'o1',
        entityType: 'deal',
        entityId: 'd1',
        occurredAt,
        payload: { title: 'x' },
      }),
    ).toEqual({
      id: 'e1',
      type: 'deal.created',
      version: 1,
      occurredAt: '2026-10-21T10:00:00.000Z',
      organizationId: 'o1',
      entity: { type: 'deal', id: 'd1' },
      data: { title: 'x' },
    });
  });
});
