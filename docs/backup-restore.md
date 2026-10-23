# پشتیبان‌گیری و بازیابی

تصمیم‌ها و محدودیت‌ها: [ADR 0025](adr/0025-backup-restore.md).

## راه‌اندازی

```bash
docker compose -f deploy/compose.dev.yml -f deploy/compose.backup.yml up -d --build backup
```

اولین پشتیبان بلافاصله ساخته می‌شود و بعد هر ۲۴ ساعت. فایل‌ها در ولوم `backups` (مسیر `/backups`) هستند:
`ishan-<UTC>.dump` (یا `.dump.enc`) و کنار آن `.sha256`.

متغیرها: `BACKUP_INTERVAL_SECONDS`، `RETENTION_DAYS`، `MIN_KEEP`، `BACKUP_PASSPHRASE_FILE` (برای رمزنگاری).
برای رمزنگاری گذرواژه را در یک فایل secret قرار دهید و مسیرش را بدهید؛ **گذرواژه را جدا از پشتیبان نگه دارید.
بدون آن بازیابی ناممکن است.**

## پشتیبان دستی

```bash
docker compose -f deploy/compose.dev.yml -f deploy/compose.backup.yml run --rm --no-deps --entrypoint backup.sh backup
```

## بازیابی

۱. فایل را از ولوم (یا نسخه‌ی بیرونی) بردارید. ۲. اول در یک دیتابیس **جدید** بازیابی و بررسی کنید:

```bash
docker compose -f deploy/compose.dev.yml -f deploy/compose.backup.yml run --rm --no-deps \
  --entrypoint restore.sh backup /backups/ishan-20261023T120000Z.dump ishan_restored
```

خروجی `restore: ok database=… tables=… migrations=…` یعنی کامل اعمال شد. بازیابی در یک تراکنش است؛ اگر
شکست بخورد دیتابیس جدید خالی/ناقص می‌ماند و نباید استفاده شود (پیام روشن چاپ می‌شود).

۳. تعویض برنامه به دیتابیس بازیابی‌شده، یکی از دو راه:

- `DATABASE_URL` را به `…/ishan_restored` تغییر دهید و api و worker را دوباره بالا بیاورید؛ یا
- با توقف api و worker، بازیابی را روی همان نام با `--replace --confirm ishan` انجام دهید
  (**دیتابیس فعلی را نابود می‌کند**).

۴. پس از بازیابی، `docker compose … up migrate` باید «No pending migrations» بدهد و ورود ادمین باید کار کند.
۵. Redis بازیابی نمی‌شود؛ شمارنده‌ها خودبه‌خود از نو شروع می‌شوند.

## تأیید دوره‌ای

`selftest.sh` کل مسیر را روی دیتابیس مشخص‌شده اجرا می‌کند (یک جدول موقت می‌سازد و پاک می‌کند، دیتابیس موقت
`<نام>_selftest_restored` را می‌سازد و حذف می‌کند). در CI با کار `backup-restore` هر بار اجرا می‌شود. توصیه:
ماهی یک بار بازیابی واقعی یک پشتیبان بیرونی را در محیط جدا تمرین کنید و زمانش را ثبت کنید (RTO).

## عیب‌یابی

| نشانه                             | معنی و اقدام                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `CHECKSUM MISMATCH`               | فایل خراب یا دست‌خورده است؛ از پشتیبان قبلی یا نسخه‌ی بیرونی استفاده کنید            |
| `decryption failed`               | گذرواژه‌ی اشتباه یا فایل خراب                                                        |
| `database '…' already exists`     | نام دیگری بدهید یا `--replace --confirm <نام>`                                       |
| healthcheck سرویس `backup` ناسالم | لاگ سرویس را ببینید (`backup: FAILED`)؛ معمولاً اتصال/گذرواژه‌ی دیتابیس یا فضای دیسک |
| `the dump contains no table data` | به دیتابیس اشتباه وصل شده‌اید یا اسکیما خالی است                                     |
