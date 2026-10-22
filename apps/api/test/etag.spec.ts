import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertIfMatch,
  assertWritten,
  casWhere,
  etagOf,
  hasPrecondition,
  unchangedSince,
} from '../src/common/etag';

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

  it('treats absent, empty and * as no precondition', () => {
    expect(hasPrecondition(undefined)).toBe(false);
    expect(hasPrecondition(' ')).toBe(false);
    expect(hasPrecondition('*')).toBe(false);
    expect(hasPrecondition('"1"')).toBe(true);
  });

  it('builds a one-millisecond compare-and-set window around updatedAt', () => {
    const w = unchangedSince(t).updatedAt;
    expect(w.gte.getTime()).toBe(t.getTime());
    expect(w.lt.getTime()).toBe(t.getTime() + 1);
  });

  it('casWhere adds the updated_at window only for a concrete tag', () => {
    expect(casWhere('r1', undefined, t)).toEqual({ id: 'r1' });
    expect(casWhere('r1', '*', t)).toEqual({ id: 'r1' });
    expect(casWhere('r1', etagOf(t), t)).toEqual({ id: 'r1', ...unchangedSince(t) });
  });

  it('assertWritten: 412 with a precondition, the given error without one, silent when written', () => {
    const gone = new HttpException('gone', 404);
    expect(() => assertWritten(1, etagOf(t), gone)).not.toThrow();
    expect(() => assertWritten(0, undefined, gone)).toThrow(gone);
    try {
      assertWritten(0, etagOf(t), gone);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(412);
    }
  });
});
