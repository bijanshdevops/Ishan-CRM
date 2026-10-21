import type { QuoteDto } from '@ishan/contracts';
import { fa, formatJalaliDate, formatMoney } from '@ishan/i18n';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Header values must never contain line breaks (header injection). */
const oneLine = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

export interface QuoteEmailInput {
  quote: Pick<QuoteDto, 'number' | 'version' | 'title' | 'total' | 'validUntil' | 'customer'>;
  organizationName: string;
  senderName: string;
  message: string | null;
}

/** Plain-text and RTL HTML body of the cover e-mail; the quote itself is the PDF attachment. */
export function buildQuoteEmail(i: QuoteEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const q = i.quote;
  const subject = oneLine(`پیش‌فاکتور ${q.number} — ${i.organizationName}`).slice(0, 200);
  const total = formatMoney(BigInt(q.total), 'toman');
  const lines = [
    `${fa.quotes.customer}: ${q.customer.name}`,
    `${q.title}`,
    `${fa.quotes.total}: ${total}`,
    ...(q.validUntil ? [`${fa.quotes.validUntil}: ${formatJalaliDate(q.validUntil)}`] : []),
  ];
  const message = i.message?.trim() ?? '';
  const text = [
    message,
    lines.join('\n'),
    'پیش‌فاکتور به‌صورت PDF پیوست شده است.',
    `${i.senderName}\n${i.organizationName}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const html = `<!doctype html><html lang="fa" dir="rtl"><body style="margin:0;background:#f5f6f8;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right"><div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e3e5ea">${message ? `<p style="font-size:14px;line-height:1.9;margin:0 0 16px;color:#14161a;white-space:pre-line">${escapeHtml(message)}</p>` : ''}<p style="font-size:14px;line-height:2;margin:0 0 16px;color:#3a3f47">${lines.map(escapeHtml).join('<br>')}</p><p style="font-size:14px;margin:0 0 16px;color:#3a3f47">پیش‌فاکتور به‌صورت PDF پیوست شده است.</p><p style="font-size:13px;margin:0;color:#6b7280">${escapeHtml(i.senderName)}<br>${escapeHtml(i.organizationName)}</p></div></div></body></html>`;
  return { subject, text, html };
}
