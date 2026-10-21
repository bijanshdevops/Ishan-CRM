import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { api, apiBaseUrl, etagFor } from './api';

describe('apiBaseUrl', () => {
  it('defaults to the same-origin proxy and trims trailing slashes', () => {
    expect(apiBaseUrl({})).toBe('/api/v1');
    expect(apiBaseUrl({ NEXT_PUBLIC_API_URL: 'https://x.test/api/v1//' })).toBe(
      'https://x.test/api/v1',
    );
  });
});

describe('If-Match', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns the version the user saw into the server tag (epoch ms, quoted)', () => {
    expect(etagFor('2026-10-20T10:00:00.123Z')).toBe(`"${Date.parse('2026-10-20T10:00:00.123Z')}"`);
  });

  it('sends If-Match only when a version is given', async () => {
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get('If-Match'));
        return new Response('{}', { status: 200 });
      }),
    );
    await api('/customers/x', { method: 'PATCH', body: {}, version: '2026-10-20T10:00:00.123Z' });
    await api('/customers/x', { method: 'PATCH', body: {} });
    expect(seen).toEqual([etagFor('2026-10-20T10:00:00.123Z'), null]);
  });
});
