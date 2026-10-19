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

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
