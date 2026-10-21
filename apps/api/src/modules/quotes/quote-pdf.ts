import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { QuoteDto } from '@ishan/contracts';
import { fa, formatJalaliDate, formatMoney, formatNumber } from '@ishan/i18n';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toman = (rial: string) => formatMoney(BigInt(rial), 'toman');
const t = fa.quotes;

let fontCss: string | null = null;
/** The Vazirmatn variable font as a data URI, so the page needs no network (read once). */
export function vazirmatnFontCss(): string {
  if (fontCss) return fontCss;
  const require = createRequire(__filename);
  const file = require.resolve('vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2');
  const b64 = readFileSync(file).toString('base64');
  fontCss = `@font-face{font-family:'Vazirmatn';font-weight:100 900;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  return fontCss;
}

const CSS = `
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}
html{direction:rtl}
body{margin:0;font-family:'Vazirmatn',sans-serif;font-size:11pt;line-height:1.8;color:#14161a;background:#fff}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-top:5px solid #1f5eff;padding-top:12px;margin-bottom:18px}
.org{font-size:10pt;color:#5b6270}
.num{font-size:20pt;font-weight:800;letter-spacing:.02em;direction:ltr;unicode-bidi:isolate;text-align:right}
.meta{font-size:10pt;text-align:left;color:#3a3f47}
h1{font-size:14pt;margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin:14px 0}
th{font-weight:600;color:#5b6270;border-bottom:2px solid #14161a;padding:6px 8px;text-align:right}
td{padding:8px;border-bottom:1px solid #e3e5ea;vertical-align:top}
th.n,td.n{text-align:left;white-space:nowrap}
tr{break-inside:avoid}
dl{margin:8px 0 0 auto;width:62%;display:grid;grid-template-columns:1fr auto;gap:4px 18px;font-size:10.5pt}
dt{color:#5b6270}
dd{margin:0;text-align:left}
dt.total,dd.total{border-top:2px solid #14161a;padding-top:6px;margin-top:6px;font-weight:800;font-size:13pt;color:#14161a}
section{margin-top:16px;break-inside:avoid}
h3{font-size:11pt;margin:0 0 4px}
p{margin:0;white-space:pre-wrap}
.status{display:inline-block;border:2px solid #1f5eff;color:#1f5eff;border-radius:6px;padding:0 10px;font-weight:700;font-size:10pt}
`;

/**
 * Self-contained, escaped HTML of one quote for the PDF renderer. Pure: the same quote always gives
 * the same markup. Nothing here loads from the network.
 */
export function buildQuoteHtml(q: QuoteDto, organizationName: string, fontFaceCss: string): string {
  const rows = q.items
    .map(
      (i, idx) =>
        `<tr><td>${formatNumber(idx + 1)}</td><td>${escapeHtml(i.description)}</td><td class="n">${formatNumber(i.quantity)}</td><td class="n">${escapeHtml(toman(i.unitPrice))}</td><td class="n"><strong>${escapeHtml(toman(i.lineTotal))}</strong></td></tr>`,
    )
    .join('');
  const note = (title: string, text: string | null) =>
    text ? `<section><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></section>` : '';
  const customerLine = `${escapeHtml(q.customer.name)}${q.contact ? ` — ${escapeHtml(q.contact.name)}` : ''}`;
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(q.number)}</title><style>${fontFaceCss}${CSS}</style></head><body>
<header>
  <div><div class="org">${escapeHtml(organizationName)}</div><div class="num">${escapeHtml(q.number)}${q.version > 1 ? ` / v${q.version}` : ''}</div><h1>${escapeHtml(q.title)}</h1><div>${escapeHtml(t.customer)}: ${customerLine}</div></div>
  <div class="meta"><div class="status">${escapeHtml(t.statuses[q.status])}</div><div>${escapeHtml(t.issueDate)}: ${escapeHtml(formatJalaliDate(q.issueDate))}</div>${q.validUntil ? `<div>${escapeHtml(t.validUntil)}: ${escapeHtml(formatJalaliDate(q.validUntil))}</div>` : ''}</div>
</header>
<table><thead><tr><th>#</th><th>${escapeHtml(t.description)}</th><th class="n">${escapeHtml(t.quantity)}</th><th class="n">${escapeHtml(t.unitPrice)}</th><th class="n">${escapeHtml(t.lineTotal)}</th></tr></thead><tbody>${rows}</tbody></table>
<dl><dt>${escapeHtml(t.subtotal)}</dt><dd>${escapeHtml(toman(q.subtotal))}</dd><dt>${escapeHtml(t.discount)}</dt><dd>${escapeHtml(toman(q.discount))}</dd><dt>${escapeHtml(t.tax)} (${formatNumber(q.taxRateBp / 100)}٪)</dt><dd>${escapeHtml(toman(q.taxAmount))}</dd><dt class="total">${escapeHtml(t.total)}</dt><dd class="total">${escapeHtml(toman(q.total))}</dd></dl>
${note(t.notes, q.notes)}${note(t.terms, q.terms)}
</body></html>`;
}

/** File name of the PDF: number and version, ASCII only (it goes into a header). */
export const quotePdfFilename = (q: Pick<QuoteDto, 'number' | 'version'>) =>
  `${q.number}-v${q.version}.pdf`;
