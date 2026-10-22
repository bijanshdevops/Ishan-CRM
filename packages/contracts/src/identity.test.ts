import { describe, expect, it } from 'vitest';
import { UpdateUserRequestSchema } from './identity';

describe('UpdateUserRequestSchema e-mail', () => {
  it('normalises the address and rejects a malformed one', () => {
    const ok = UpdateUserRequestSchema.safeParse({ email: '  A@Example.COM ' });
    expect(ok.success && ok.data.email).toBe('a@example.com');
    expect(UpdateUserRequestSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('still needs at least one field', () => {
    expect(UpdateUserRequestSchema.safeParse({}).success).toBe(false);
  });
});
