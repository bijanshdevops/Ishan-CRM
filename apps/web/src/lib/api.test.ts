import { describe, expect, it } from 'vitest';
import { apiBaseUrl } from './api';

describe('apiBaseUrl', () => {
  it('defaults to the same-origin proxy and trims trailing slashes', () => {
    expect(apiBaseUrl({})).toBe('/api/v1');
    expect(apiBaseUrl({ NEXT_PUBLIC_API_URL: 'https://x.test/api/v1//' })).toBe(
      'https://x.test/api/v1',
    );
  });
});
