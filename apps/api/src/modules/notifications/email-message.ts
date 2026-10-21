export interface EmailNotification {
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Header values must never contain line breaks (header injection). */
const oneLine = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

/** Path of the page a notification leads to; mirrors apps/web/src/lib/notification-links.ts. */
export function notificationPath(n: Pick<EmailNotification, 'entityType' | 'entityId'>): string {
  if (!n.entityType || !n.entityId) return '/';
  const id = encodeURIComponent(n.entityId);
  switch (n.entityType) {
    case 'customer':
      return `/customers/${id}`;
    case 'quote':
      return `/quotes/${id}`;
    case 'contract':
      return `/contracts/${id}`;
    case 'webhook':
      return `/webhooks/${id}`;
    case 'lead':
      return '/leads';
    case 'deal':
      return '/deals';
    case 'activity':
      return '/activities';
    default:
      return '/';
  }
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Plain-text + RTL HTML body. Every dynamic value is escaped; the link is built from trusted config. */
export function buildNotificationEmail(n: EmailNotification, appBaseUrl: string): BuiltEmail {
  const base = appBaseUrl.replace(/\/+$/, '');
  const link = `${base}${notificationPath(n)}`;
  const subject = oneLine(n.title).slice(0, 200) || 'اعلان جدید در ایشان';
  const body = n.body?.trim() ?? '';
  const text = [
    n.title.trim(),
    body,
    `باز کردن در ایشان: ${link}`,
    '',
    'این پیام به‌صورت خودکار ارسال شده است. از بخش حساب کاربری می‌توانید ارسال ایمیل را خاموش کنید.',
  ]
    .filter((l, i) => l !== '' || i > 2)
    .join('\n\n');
  const html = `<!doctype html><html lang="fa" dir="rtl"><body style="margin:0;background:#f5f6f8;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right"><div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e3e5ea"><h1 style="font-size:18px;margin:0 0 12px;color:#14161a">${escapeHtml(n.title.trim())}</h1>${body ? `<p style="font-size:14px;line-height:1.9;margin:0 0 20px;color:#3a3f47;white-space:pre-line">${escapeHtml(body)}</p>` : ''}<a href="${escapeHtml(link)}" style="display:inline-block;background:#1f5eff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">باز کردن در ایشان</a></div><p style="font-size:12px;color:#6b7280;margin:16px 4px 0">این پیام به‌صورت خودکار ارسال شده است. از بخش حساب کاربری می‌توانید ارسال ایمیل را خاموش کنید.</p></div></body></html>`;
  return { subject, text, html };
}
