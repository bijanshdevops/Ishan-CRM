import { existsSync } from 'node:fs';
import type { QuoteDto } from '@ishan/contracts';
import { describe, expect, it } from 'vitest';
import { PdfRenderer } from '../src/modules/quotes/pdf-renderer';
import { buildQuoteEmail } from '../src/modules/quotes/quote-email-message';
import {
  buildQuoteHtml,
  quotePdfFilename,
  vazirmatnFontCss,
} from '../src/modules/quotes/quote-pdf';

const CHROMIUM = [process.env.PDF_CHROMIUM_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => Boolean(p))
  .find((p) => existsSync(p));

const quote: QuoteDto = {
  id: '0197c0de-0000-7000-8000-000000000001',
  number: 'QT-000012',
  version: 2,
  title: 'پیشنهاد <img src=x onerror=alert(1)>',
  status: 'SENT',
  expired: false,
  customer: { id: 'c', name: 'شرکت "الف" & ب' },
  contact: { id: 'k', name: 'رضا موسوی' },
  deal: null,
  owner: null,
  issueDate: '2026-10-21',
  validUntil: '2026-11-21',
  subtotal: '30000000',
  discount: '5000000',
  taxRateBp: 1000,
  taxAmount: '2500000',
  total: '27500000',
  notes: '<script>alert(1)</script>\nخط دوم',
  terms: null,
  items: [
    {
      id: 'i',
      position: 1,
      productId: null,
      description: '<b>خدمت</b>',
      quantity: 3,
      unitPrice: '10000000',
      lineTotal: '30000000',
    },
  ],
  contract: null,
  latestVersion: 2,
  sentAt: null,
  decidedAt: null,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
};

describe('quote PDF markup', () => {
  const html = buildQuoteHtml(quote, 'سازمان <نمونه>', '/*font*/');

  it('escapes every dynamic value', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('شرکت &quot;الف&quot; &amp; ب');
    expect(html).toContain('سازمان &lt;نمونه&gt;');
  });

  it('is right-to-left Persian with Persian digits and toman amounts', () => {
    expect(html).toContain('lang="fa" dir="rtl"');
    expect(html).toContain('QT-000012');
    expect(html).toContain('/ v2');
    expect(html).toContain('۲٬۷۵۰٬۰۰۰ تومان'); // 27,500,000 rials = 2,750,000 toman
    expect(html).not.toMatch(/src=["']?https?:/i);
  });

  it('is deterministic and needs no network', () => {
    expect(buildQuoteHtml(quote, 'سازمان <نمونه>', '/*font*/')).toBe(html);
    expect(html).not.toMatch(/<link|<script|@import|url\(https?:/i);
  });

  it('names the file after the number and version', () => {
    expect(quotePdfFilename(quote)).toBe('QT-000012-v2.pdf');
  });

  it('embeds the font as data', () => {
    expect(vazirmatnFontCss()).toMatch(
      /^@font-face\{font-family:'Vazirmatn'.*data:font\/woff2;base64,/,
    );
  });
});

describe('quote e-mail body', () => {
  const mail = buildQuoteEmail({
    quote,
    organizationName: 'سازمان\r\nBcc: x@evil.test',
    senderName: 'علی <b>',
    message: '<script>x</script>\nسلام',
  });
  it('keeps the subject on one line and escapes the html', () => {
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>');
    expect(mail.text).toContain('پیش‌فاکتور به‌صورت PDF پیوست شده است.');
  });
});

describe.skipIf(!CHROMIUM)('PdfRenderer (real Chromium)', () => {
  it('renders a PDF with the Persian text embedded, several at once', async () => {
    const r = new PdfRenderer(CHROMIUM);
    try {
      expect(r.available).toBe(true);
      const html = buildQuoteHtml(quote, 'سازمان نمونه', vazirmatnFontCss());
      const pdfs = await Promise.all([r.render(html), r.render(html), r.render(html)]);
      for (const pdf of pdfs) {
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.length).toBeGreaterThan(5_000);
        // the font is embedded (subset names are kept in the file)
        expect(pdf.toString('latin1')).toMatch(/Vazirmatn/);
      }
    } finally {
      await r.close();
    }
  }, 60_000);

  it('is unavailable without a browser path', async () => {
    const r = new PdfRenderer('/nonexistent/chrome');
    expect(r.available).toBe(false);
    await expect(r.render('<p>x</p>')).rejects.toThrow(/not available/);
  });
});
