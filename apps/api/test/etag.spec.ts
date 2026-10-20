import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertIfMatch, etagOf } from '../src/common/etag';

describe('etag', () => {
  const t = new Date('2026-10-20T10:00:00.123Z');

  it('derives a quoted validator from updatedAt', () => {
    expect(etagOf(t)).toBe(`"${t.getTime()}"`);
    expect(etagOf(t.toISOString())).toBe(etagOf(t));
  });

  it('passes without a header, with *, and with the current tag (weak form too)', () => {
    expect(() => assertIfMatch(undefined, t)).not.toThrow();
    expect(() => assertIfMatch('', t)).not.toThrow();
    expect(() => assertIfMatch('*', t)).not.toThrow();
    expect(() => assertIfMatch(etagOf(t), t)).not.toThrow();
    expect(() => assertIfMatch(`W/${etagOf(t)}`, t)).not.toThrow();
    expect(() => assertIfMatch(`"1", ${etagOf(t)}`, t)).not.toThrow();
  });

  it('refuses a stale tag with 412 STALE_ENTITY', () => {
    try {
      assertIfMatch(etagOf(new Date(t.getTime() - 1000)), t);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(412);
      expect(((e as HttpException).getResponse() as { code: string }).code).toBe('STALE_ENTITY');
    }
  });
});
