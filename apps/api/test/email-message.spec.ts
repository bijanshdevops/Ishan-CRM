import { describe, expect, it } from 'vitest';
import {
  buildNotificationEmail,
  notificationPath,
} from '../src/modules/notifications/email-message';
import { loadConfig } from '../src/config';
import { TEST_ENV } from './helpers';
import { EMAIL_BACKOFF_MINUTES, emailRetryDelayMinutes } from '@ishan/contracts';

describe('notification e-mail message', () => {
  const n = { title: 'سلام', body: null, entityType: 'customer', entityId: 'abc' };

  it('builds a link from the base URL without double slashes', () => {
    const m = buildNotificationEmail(n, 'https://crm.example.com/');
    expect(m.text).toContain('https://crm.example.com/customers/abc');
    expect(m.html).toContain('href="https://crm.example.com/customers/abc"');
    expect(m.html).toContain('dir="rtl"');
  });

  it('escapes every dynamic value in the HTML body', () => {
    const m = buildNotificationEmail(
      {
        title: '<script>alert(1)</script>',
        body: '"><img src=x onerror=1>',
        entityType: null,
        entityId: null,
      },
      'https://crm.example.com',
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('never lets a title break the subject header', () => {
    const m = buildNotificationEmail(
      { ...n, title: 'a\r\nBcc: evil@example.com' },
      'https://crm.example.com',
    );
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it('maps entities like the web app and falls back to the root', () => {
    expect(notificationPath({ entityType: 'deal', entityId: 'x' })).toBe('/deals');
    expect(notificationPath({ entityType: 'quote', entityId: 'x y' })).toBe('/quotes/x%20y');
    expect(notificationPath({ entityType: 'webhook', entityId: 'w' })).toBe('/webhooks/w');
    expect(notificationPath({ entityType: 'unknown', entityId: 'x' })).toBe('/');
    expect(notificationPath({ entityType: null, entityId: null })).toBe('/');
  });
});

describe('e-mail retry schedule', () => {
  it('backs off 1/10/60/360 minutes and gives up after the fifth attempt', () => {
    expect(EMAIL_BACKOFF_MINUTES).toEqual([1, 10, 60, 360]);
    expect([1, 2, 3, 4, 5].map(emailRetryDelayMinutes)).toEqual([1, 10, 60, 360, null]);
  });
});

describe('SMTP configuration', () => {
  const base = { ...TEST_ENV, DATABASE_URL: 'postgresql://u:p@localhost:5432/d' };

  it('leaves the channel off when SMTP_HOST is absent', () => {
    expect(loadConfig(base).SMTP_HOST).toBeUndefined();
  });

  it('requires sender and base URL once SMTP_HOST is set', () => {
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com' })).toThrow(/EMAIL_FROM/);
    expect(() =>
      loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'a@example.com' }),
    ).toThrow(/APP_BASE_URL/);
  });

  it('requires the SMTP user and password together', () => {
    expect(() =>
      loadConfig({
        ...base,
        SMTP_HOST: 'smtp.example.com',
        EMAIL_FROM: 'a@example.com',
        APP_BASE_URL: 'https://crm.example.com',
        SMTP_USER: 'u',
      }),
    ).toThrow(/SMTP_USER and SMTP_PASSWORD/);
  });
});
