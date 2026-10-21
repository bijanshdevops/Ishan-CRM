import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Self-contained, signed unsubscribe token (ADR 0015): `base64url(JSON{o,e}).hex(HMAC)`.
 * Nothing is stored, so a link keeps working after the recipient history is purged.
 */
export function signUnsubscribe(key: string, organizationId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ o: organizationId, e: email })).toString(
    'base64url',
  );
  return `${payload}.${mac(key, payload)}`;
}

export function verifyUnsubscribe(
  key: string,
  token: string,
): { organizationId: string; email: string } | null {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(key, payload), 'hex');
  const given = Buffer.from(sig, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      o?: unknown;
      e?: unknown;
    };
    if (typeof v.o !== 'string' || typeof v.e !== 'string') return null;
    return { organizationId: v.o, email: v.e };
  } catch {
    return null;
  }
}

const mac = (key: string, payload: string) =>
  createHmac('sha256', Buffer.from(key, 'base64')).update(`unsubscribe:${payload}`).digest('hex');
