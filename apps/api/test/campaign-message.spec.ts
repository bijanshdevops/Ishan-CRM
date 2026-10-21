import { describe, expect, it } from 'vitest';
import {
  SaveCampaignSendingSchema,
  renderCampaignText,
  unknownCampaignFields,
} from '@ishan/contracts';
import { buildCampaignEmail } from '../src/modules/marketing/campaign-message';
import { signUnsubscribe, verifyUnsubscribe } from '../src/modules/marketing/unsubscribe-token';

const KEY = Buffer.alloc(32, 9).toString('base64');
const ORG = '0197c0de-0000-7000-8000-000000000001';

describe('campaign text', () => {
  it('allows only the customerName merge field', () => {
    expect(unknownCampaignFields('سلام {{customerName}} و {{ customerName }}')).toEqual([]);
    expect(unknownCampaignFields('{{email}} {{ x }} {{customerName}}')).toEqual(['email', 'x']);
    expect(renderCampaignText('سلام {{ customerName }}!', 'علی')).toBe('سلام علی!');
  });

  it('rejects unknown fields, multi-line subjects and extra keys', () => {
    const ok = { subject: 's', body: 'b', audience: { tagIds: [], kind: null } };
    expect(SaveCampaignSendingSchema.safeParse(ok).success).toBe(true);
    expect(SaveCampaignSendingSchema.safeParse({ ...ok, subject: 'a\nb' }).success).toBe(false);
    expect(SaveCampaignSendingSchema.safeParse({ ...ok, body: '{{x}}' }).success).toBe(false);
    expect(SaveCampaignSendingSchema.safeParse({ ...ok, x: 1 }).success).toBe(false);
  });
});

describe('campaign e-mail', () => {
  const link = 'https://crm.example.com/unsubscribe?token=abc';

  it('escapes the body and the name in HTML and keeps paragraphs', () => {
    const m = buildCampaignEmail({
      subject: 'a\r\nBcc: evil@example.com',
      body: '<script>x</script> {{customerName}}\n\nخط دوم\nسطر بعد',
      name: '"><img src=x>',
      unsubscribeUrl: link,
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img');
    expect(m.html.match(/<p /g)).toHaveLength(3); // two paragraphs and the footer
    expect(m.html).toContain('<br>');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).toContain(`href="${link}"`);
    expect(m.text).toContain(link);
  });

  it('omits the link only for the self-test mail', () => {
    const m = buildCampaignEmail({ subject: 's', body: 'b', name: 'n', unsubscribeUrl: null });
    expect(m.html).not.toContain('href=');
    expect(m.text).not.toContain('http');
  });
});

describe('unsubscribe token', () => {
  it('round-trips and rejects any tampering', () => {
    const t = signUnsubscribe(KEY, ORG, 'a@b.test');
    expect(verifyUnsubscribe(KEY, t)).toEqual({ organizationId: ORG, email: 'a@b.test' });
    const [p, s] = t.split('.');
    const other = Buffer.from(JSON.stringify({ o: ORG, e: 'x@y.test' })).toString('base64url');
    expect(verifyUnsubscribe(KEY, `${other}.${s}`)).toBeNull();
    expect(verifyUnsubscribe(KEY, `${p}.${'0'.repeat(64)}`)).toBeNull();
    expect(verifyUnsubscribe(KEY, `${p}.${s}.z`)).toBeNull();
    expect(verifyUnsubscribe(KEY, 'garbage')).toBeNull();
    expect(verifyUnsubscribe(Buffer.alloc(32, 1).toString('base64'), t)).toBeNull();
  });
});
