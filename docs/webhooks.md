# وب‌هوک خروجی ایشان

وب‌هوک به سامانه‌ی بیرونی (حسابداری، پیام‌رسان، Zapier/n8n …) خبر می‌دهد که در ایشان چیزی رخ داده است. طراحی و
دلیل تصمیم‌ها در [ADR 0012](adr/0012-webhooks.md) است؛ این سند راهنمای **گیرنده** و **مدیر سامانه** است.

## راه‌اندازی

1. (فقط مدیر سیستم) یک Endpoint بسازید: `POST /api/v1/webhooks` با `name`، `url` (فقط `https://`) و `eventTypes`.
2. پاسخ شامل `secret` است (`whsec_…`). **فقط همین یک‌بار نشان داده می‌شود**؛ آن را در گیرنده ذخیره کنید.
   گم‌شدنش یعنی `POST /webhooks/:id/rotate-secret`.
3. `POST /webhooks/:id/test` یک رویداد `webhook.test` می‌فرستد تا اتصال و امضا را بیازمایید.

رویدادها: `lead.created`، `lead.converted`، `deal.created`، `deal.stage_changed`، `quote.accepted`، `quote.rejected`،
`activity.overdue`، `contract.expiring` (فهرست زنده: `GET /webhooks/catalog`).

## درخواستی که گیرنده می‌بیند

`POST` با `Content-Type: application/json` و هدرها:

| هدر                 | معنی                                                         |
| ------------------- | ------------------------------------------------------------ |
| `X-Ishan-Event`     | نوع رویداد                                                   |
| `X-Ishan-Delivery`  | شناسه‌ی تحویل؛ در تلاش‌های دوباره‌ی همان رویداد ثابت است     |
| `X-Ishan-Signature` | `t=<ثانیه‌ی یونیکس>,v1=<hex>` (هنگام چرخش راز دو `v1=` دارد) |

بدنه:

```json
{
  "id": "0197…",
  "type": "deal.stage_changed",
  "version": 1,
  "occurredAt": "2026-10-21T10:00:00.000Z",
  "organizationId": "0197…",
  "entity": { "type": "deal", "id": "0197…" },
  "data": { "title": "قرارداد الف", "stageKind": "WON", "amount": "5000000" }
}
```

مبلغ‌ها همیشه **رشته‌ی ریال** هستند (عدد صحیح، بدون اعشار). فیلد تازه ممکن است به `data` اضافه شود؛ گیرنده
فیلد ناشناخته را نادیده بگیرد. حذف یا تغییر معنی فقط با `version` تازه انجام می‌شود.

## راستی‌آزمایی امضا

امضا `HMAC-SHA256` روی رشته‌ی `"<t>.<بدنه‌ی خام>"` با کلید `secret` است (hex کوچک). **بدنه‌ی خام** را بسنجید، نه
JSON دوباره‌سریال‌شده. زمان‌ثابت مقایسه کنید و `t` قدیمی‌تر از ۵ دقیقه را رد کنید.

```js
// Node.js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, now = Date.now() / 1000) {
  const parts = header.split(',').map((p) => p.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isInteger(t) || Math.abs(now - t) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return parts
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const got = Buffer.from(v, 'hex');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}
```

```python
# Python
import hashlib, hmac, time

def verify(secret: str, header: str, raw_body: bytes, now=None) -> bool:
    parts = [p.split("=", 1) for p in header.split(",")]
    t = next((int(v) for k, v in parts if k == "t"), None)
    if t is None or abs((now or time.time()) - t) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(v, expected) for k, v in parts if k == "v1")
```

## تحویل و تلاش دوباره

- موفقیت یعنی پاسخ **`2xx` در ۱۰ ثانیه**. ریدایرکت دنبال **نمی‌شود** (۳xx = شکست). همین الان پاسخ بدهید و کار
  سنگین را بعداً انجام دهید.
- تحویل **حداقل یک‌بار** است؛ با `X-Ishan-Delivery` (یا `id` رویداد) تکراری‌ها را کنار بگذارید. ترتیب بین رویدادها
  تضمین نمی‌شود؛ با `occurredAt` مرتب کنید.
- شکست = تلاش دوباره پس از ۱ دقیقه، ۵ دقیقه، ۳۰ دقیقه، ۲ ساعت، ۶ ساعت و ۲۴ ساعت (جمعاً ۷ تلاش)، سپس `FAILED`.
- ۱۰ تحویل نهایی ناموفق پیاپی ← Endpoint خودکار **خاموش** می‌شود (`disabledReason: "AUTO_FAILURES"`) و سازنده‌اش
  اعلان می‌گیرد. پس از رفع مشکل با `POST /webhooks/:id/enable` روشنش کنید.
- تاریخچه: `GET /webhooks/:id/deliveries` (وضعیت، کد پاسخ، ۵۰۰ نویسه‌ی اول پاسخ)؛ ارسال مجدد:
  `POST /webhooks/deliveries/:id/redeliver`. تاریخچه ۳۰ روز نگه داشته می‌شود.

## چرخش راز

`POST /webhooks/:id/rotate-secret` راز تازه می‌دهد. تا **۲۴ ساعت** هر درخواست با هر دو راز امضا می‌شود (دو `v1=`)،
پس گیرنده بدون وقفه جابه‌جا می‌شود: راز تازه را در گیرنده بگذارید؛ بعد از ۲۴ ساعت راز قدیمی کار نمی‌کند.

## محدودیت‌های ایمنی (برای مدیر شبکه)

- فقط `https://` به میزبان عمومی. آدرس‌هایی که به شبکه‌ی داخلی (۱۰/۸، ۱۷۲.۱۶/۱۲، ۱۹۲.۱۶۸/۱۶، loopback، link-local و
  metadata ابری `169.254.169.254`، `fc00::/7` …) حل شوند رد می‌شوند؛ بررسی هم هنگام ثبت و هم **در هر ارسال** انجام
  می‌شود و اتصال به همان IP بررسی‌شده برقرار می‌شود.
- IP خروجی ثابت نیست. اگر گیرنده فهرست IP می‌خواهد، پراکسی خروجی لازم است (خارج از دامنه‌ی نسخه‌ی اول).
- کلیدهای پیکربندی: `WEBHOOK_DELIVERY_RETENTION_DAYS` (پیش‌فرض ۳۰)، `WEBHOOK_ALLOW_INSECURE=true` (فقط
  توسعه/آزمون؛ در Production نادیده گرفته می‌شود و `http://localhost` را مجاز می‌کند). راز‌ها با `ENCRYPTION_KEY` رمز
  می‌شوند؛ این کلید را عوض کنید، راز همه‌ی Endpointها باید دوباره چرخانده شود.
