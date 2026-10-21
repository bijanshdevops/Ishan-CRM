import { renderCampaignText } from '@ishan/contracts';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const oneLine = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

export interface BuiltCampaignEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Plain-text campaign body to a safe RTL HTML mail: paragraphs on blank lines, line breaks inside.
 * `unsubscribeUrl` is null only for the test e-mail a user sends to themselves.
 */
export function buildCampaignEmail(input: {
  subject: string;
  body: string;
  name: string;
  unsubscribeUrl: string | null;
}): BuiltCampaignEmail {
  const body = renderCampaignText(input.body, input.name).replace(/\r\n?/g, '\n').trim();
  const subject = oneLine(renderCampaignText(input.subject, input.name)).slice(0, 200);
  const footer = input.unsubscribeUrl
    ? `برای دریافت نکردن این ایمیل‌ها: ${input.unsubscribeUrl}`
    : 'این یک ایمیل آزمایشی است و پیوند لغو اشتراک ندارد.';
  const text = `${body}\n\n--\n${footer}`;
  const paragraphs = body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:2;color:#26292e">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const foot = input.unsubscribeUrl
    ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7280">لغو دریافت این ایمیل‌ها</a>`
    : escapeHtml(footer);
  const html = `<!doctype html><html lang="fa" dir="rtl"><body style="margin:0;background:#f5f6f8;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right"><div style="max-width:600px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e3e5ea">${paragraphs}</div><p style="font-size:12px;color:#6b7280;margin:16px 4px 0">${foot}</p></div></body></html>`;
  return { subject, text, html };
}
