/** Sub-path the app is served under (the public demo lives at /demo); empty everywhere else. */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/** True in the build of the public live demo (ADR 0026). */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === 'true';

/** For full-page navigations (`window.location`), which Next does not prefix with the base path. */
export const withBase = (path: string): string => `${BASE_PATH}${path}`;
