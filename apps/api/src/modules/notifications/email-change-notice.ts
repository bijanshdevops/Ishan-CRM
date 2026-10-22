const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** `sara.ahmadi@example.com` → `s***@example.com`: enough to recognise, not enough to reuse. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Security notice for the address an account is leaving (ADR 0021). It never contains the new
 * address in full and no link or button: the reader is only told, and who to ask.
 */
export function buildEmailChangeNotice(input: { oldEmail: string; newEmail: string }) {
  const masked = maskEmail(input.newEmail);
  const text = [
    'نشانی ایمیل حساب شما در ایشان توسط یکی از مدیران سامانه تغییر کرد.',
    '',
    `نشانی تازه: ${masked}`,
    '',
    'از این پس اعلان‌ها به نشانی تازه می‌رود و ورود با همین نشانی انجام می‌شود؛ همه‌ی نشست‌های باز شما بسته شد.',
    'اگر از این تغییر خبر نداشتید، فوراً با مدیر سامانه تماس بگیرید.',
  ].join('\n');
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9"><p>نشانی ایمیل حساب شما در ایشان توسط یکی از مدیران سامانه تغییر کرد.</p><p>نشانی تازه: <span dir="ltr">${escapeHtml(masked)}</span></p><p>از این پس اعلان‌ها به نشانی تازه می‌رود و ورود با همین نشانی انجام می‌شود؛ همه‌ی نشست‌های باز شما بسته شد.</p><p><strong>اگر از این تغییر خبر نداشتید، فوراً با مدیر سامانه تماس بگیرید.</strong></p></div>`;
  return {
    to: input.oldEmail,
    subject: 'نشانی ایمیل حساب شما در ایشان تغییر کرد',
    text,
    html,
    headers: { 'Auto-Submitted': 'auto-generated' },
  };
}
