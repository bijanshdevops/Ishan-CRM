import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { api, apiBaseUrl, resetEtags } from './api';

describe('apiBaseUrl', () => {
  it('defaults to the same-origin proxy and trims trailing slashes', () => {
    expect(apiBaseUrl({})).toBe('/api/v1');
    expect(apiBaseUrl({ NEXT_PUBLIC_API_URL: 'https://x.test/api/v1//' })).toBe(
      'https://x.test/api/v1',
    );
  });
});

describe('If-Match', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetEtags();
  });
  const reply = (body: unknown, etag?: string) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: etag ? { etag } : undefined,
    });

  it('sends the tag read earlier on PATCH, then the fresh one, and drops it after other writes', async () => {
    const seen: Array<string | undefined> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      if (init?.method === 'PATCH') seen.push(h.get('If-Match') ?? undefined);
      if (init?.method === 'PATCH') return reply({ id: 'x' }, '"2"');
      if (init?.method === 'POST') return reply({ id: 'x' });
      return reply({ id: 'x' }, '"1"');
    });
    vi.stubGlobal('fetch', fetchMock);

    await api('/customers/x');
    await api('/customers/x', { method: 'PATCH', body: { name: 'a' } });
    await api('/customers/x', { method: 'PATCH', body: { name: 'b' } });
    await api('/customers/x/tags', { method: 'POST', body: {} });
    await api('/customers/x', { method: 'PATCH', body: { name: 'c' } });
    expect(seen).toEqual(['"1"', '"2"', undefined]);
  });
});
