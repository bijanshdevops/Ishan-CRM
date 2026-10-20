import type { ApiError } from '@ishan/contracts';

/** Base URL of the API as seen by the browser (same-origin proxy by default). */
export function apiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_API_URL ?? '/api/v1').replace(/\/+$/, '');
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * ETags of single entities this tab has read, keyed by path. A PATCH sends the tag it last saw
 * (`If-Match`), so saving a stale form fails with 412 instead of overwriting a colleague's edit.
 */
const etags = new Map<string, string>();
const entityKey = (path: string) => path.split('?')[0]!;
const entityRoot = (path: string) => entityKey(path).split('/').slice(0, 3).join('/');

/** @internal exported for tests */
export function resetEtags(): void {
  etags.clear();
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const known = method === 'PATCH' ? etags.get(entityKey(path)) : undefined;
  if (known) headers['If-Match'] = known;
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.ok && method !== 'GET') {
    // Any write may move updated_at of the entity or its children: forget what we knew.
    const root = entityRoot(path);
    for (const key of [...etags.keys()])
      if (key === root || key.startsWith(`${root}/`)) etags.delete(key);
  }
  const tag = res.headers?.get?.('etag');
  if (res.ok && tag && (method === 'GET' || method === 'PATCH')) etags.set(entityKey(path), tag);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as Partial<ApiError> | undefined)?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? 'خطایی رخ داد',
      err?.details,
    );
  }
  return data as T;
}

/** Fetches a binary/text resource (e.g. CSV export) with credentials. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${apiBaseUrl()}${path}`, { credentials: 'include' });
  if (!res.ok) throw new ApiClientError(res.status, 'ERROR', 'خطایی رخ داد');
  return res.blob();
}
