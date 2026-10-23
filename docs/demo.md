# دموی زندهٔ ایشان

دمو یک استقرار جداست (ADR 0026) که در `https://ishan.greenlanco.ir/demo` سرو می‌شود. بازدیدکننده بدون ثبت‌نام با نقش محدود وارد می‌شود، آزادانه می‌نویسد و هر ساعت همه‌چیز به داده‌ی فرضی برمی‌گردد.

## راه‌اندازی روی سرور
```sh
cp deploy/demo.env.example deploy/demo.env
# DEMO_POSTGRES_PASSWORD: openssl rand -hex 24
# DEMO_ENCRYPTION_KEY:    openssl rand -base64 32
docker network create greenlanco_internal   # فقط اگر استک وب‌سایت روی همین میزبان بالا نیست
docker compose -f deploy/compose.demo.yml --env-file deploy/demo.env up -d --build
```
کانتینر `web` با نام `ishan-demo-app` به شبکهٔ `greenlanco_internal` می‌پیوندد؛ nginx وب‌سایت به `ishan-demo-app:3000` پروکسی می‌کند. هیچ پورتی روی میزبان باز نمی‌شود.

## چه چیزی بسته است
بدون: کاربران، نقش‌ها، ممیزی، وب‌هوک، ارسال کمپین، ورود/خروج انبوه داده، تنظیم قیف فروش، تغییر گذرواژه/MFA. ایمیل ارسال نمی‌شود (SMTP تنظیم نیست و پیکربندی با آن رد می‌شود).

## بازنشانی
- خودکار: سرویس `reset` در ابتدای هر ساعت.
- دستی: `docker compose -f deploy/compose.demo.yml --env-file deploy/demo.env exec reset node dist/modules/demo/reset-cli.js`

## عیب‌یابی
- صفحهٔ ورود «ورود انجام نشد» را نشان می‌دهد: لاگ `api` را ببینید؛ معمولاً `reset` هنوز کاربر دمو را نساخته است (چند ثانیه پس از بالا آمدن).
- همهٔ بازدیدکنندگان «تعداد درخواست‌ها زیاد» می‌گیرند: `TRUST_PROXY` کمتر از تعداد هاپ‌هاست (ADR 0024)؛ مقدار را در `compose.demo.yml` اصلاح کنید.
- داده خالی است: `reset` را دستی اجرا کنید و لاگش را بخوانید.

## ریسک پذیرفته‌شده
حجم نوشتن بازدیدکنندگان در بازهٔ یک ساعت محدود نشده است؛ بازنشانی ساعتی و بسته‌بودن ورود انبوه داده آن را مهار می‌کند.
