import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits). */
@Injectable()
export class TotpService {
  generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  otpauthUrl(secret: string, accountEmail: string, issuer = 'Ishan CRM'): string {
    const label = encodeURIComponent(`${issuer}:${accountEmail}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  }

  codeAt(secret: string, timeMs: number): string {
    const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', base32Decode(secret)).update(msg).digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const bin =
      ((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!;
    return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
  }

  /** Accepts the current step and ±1 step of clock drift. */
  verify(secret: string, code: string, nowMs: number = Date.now()): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    let ok = false;
    for (const drift of [-1, 0, 1]) {
      const expected = Buffer.from(this.codeAt(secret, nowMs + drift * STEP_SECONDS * 1000));
      if (timingSafeEqual(expected, Buffer.from(code))) ok = true;
    }
    return ok;
  }
}
