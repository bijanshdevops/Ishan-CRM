import { describe, expect, it } from 'vitest';
import { buildCsp } from './proxy';

describe('buildCsp', () => {
  it('allows scripts only with the nonce and blocks plugins and framing', () => {
    const csp = buildCsp('abc', false);
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).toContain(`frame-ancestors 'none'`);
  });
  it('permits eval and websockets only in development', () => {
    expect(buildCsp('abc', true)).toContain(`'unsafe-eval'`);
    expect(buildCsp('abc', false)).not.toContain('ws:');
  });
});
