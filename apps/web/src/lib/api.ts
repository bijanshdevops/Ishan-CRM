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
 * `version` is the `updatedAt` of the entity the user was looking at. It is sent as `If-Match`,
 * so saving a stale form fails with 412 instead of overwriting a colleague's edit.
 */
export const etagFor = (updatedAt: string) => `"${new Date(updatedAt).getTime()}"`;

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; version?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.version) headers['If-Match'] = etagFor(init.version);
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
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
