import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_SECRET_PREFIX, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS } from '@ishan/contracts';

/** `whsec_` + 32 random bytes (base64url). */
export function generateWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBytes(32).toString('base64url');
}

export const secretHint = (secret: string): string => secret.slice(-4);

/** HMAC-SHA256(secret, "<t>.<raw body>") as lowercase hex. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * `X-Ishan-Signature` value: `t=<unix seconds>,v1=<hex>[,v1=<hex of the previous secret>]`.
 * During a rotation the previous secret signs too, so receivers can switch without downtime.
 */
export function signatureHeader(secrets: string[], timestamp: number, body: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${signPayload(s, timestamp, body)}`)].join(
    ',',
  );
}

/** Reference verifier (also what docs/webhooks.md shows). Constant-time, rejects stale timestamps. */
export function verifySignature(
  secret: string,
  header: string,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(signPayload(secret, t, body), 'hex');
  return parts
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const got = Buffer.from(v ?? '', 'hex');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}
