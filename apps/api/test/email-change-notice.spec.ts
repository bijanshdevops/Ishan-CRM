import { describe, expect, it } from 'vitest';
import {
  buildEmailChangeNotice,
  maskEmail,
} from '../src/modules/notifications/email-change-notice';

describe('email change notice', () => {
  it('masks everything but the first letter and the domain', () => {
    expect(maskEmail('sara.ahmadi@example.com')).toBe('s***@example.com');
    expect(maskEmail('x@y.io')).toBe('x***@y.io');
    expect(maskEmail('broken')).toBe('***');
  });

  it('goes to the old address, shows the new one only masked, and has no link', () => {
    const m = buildEmailChangeNotice({
      oldEmail: 'old@example.com',
      newEmail: 'secret.person@evil.example',
    });
    expect(m.to).toBe('old@example.com');
    const all = `${m.subject}${m.text}${m.html}`;
    expect(all).not.toContain('secret.person');
    expect(m.text).toContain('s***@evil.example');
    expect(all).not.toMatch(/https?:\/\//);
    expect(m.headers['Auto-Submitted']).toBe('auto-generated');
  });

  it('escapes markup in the masked address', () => {
    const m = buildEmailChangeNotice({ oldEmail: 'a@b.co', newEmail: '<x>@e.co' });
    expect(m.html).not.toContain('<x>');
  });
});
