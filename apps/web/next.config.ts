import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** Same-origin proxy to the API so the session cookie is first-party and no CORS is needed. */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@ishan/ui', '@ishan/i18n'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
};

export default nextConfig;
