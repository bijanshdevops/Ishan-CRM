/** Base URL of the API as seen by the browser (via the reverse proxy) or the server. */
export function apiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
}
