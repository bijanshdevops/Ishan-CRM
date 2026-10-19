# ایشان (Ishan CRM)

سامانه مدیریت ارتباط با مشتریان، فارسی‌محور (RTL، تقویم شمسی)، مونوریپوی ماژولار.

- **فرانت‌اند:** Next.js (App Router) · **بک‌اند:** NestJS (Fastify) · **دیتابیس:** PostgreSQL + Prisma
- معماری و نقشه راه کامل: سند «ایشان CRM — معماری و نقشه راه» (فاز ۰ تا ۸). تصمیمات در [`docs/adr`](docs/adr).

## پیش‌نیازها

Node.js 22، pnpm 10 (`corepack enable`)، Docker (اختیاری).

## اجرای محلی

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # مقادیر را بررسی کنید
docker compose -f deploy/compose.dev.yml up postgres redis -d
pnpm db:generate && pnpm db:migrate
pnpm dev                                      # web: :3000 ، api: :4000
```

اجرای کل پشته با Docker: `docker compose -f deploy/compose.dev.yml up --build`

- سلامت API: `GET /api/v1/health/live` و `GET /api/v1/health/ready`
- مستندات OpenAPI (فقط خارج از production): `/api/docs`

## دستورات

| دستور                          | کار                          |
| ------------------------------ | ---------------------------- |
| `pnpm build`                   | بیلد همه بسته‌ها             |
| `pnpm typecheck` / `pnpm test` | بررسی نوع‌ها / تست‌ها        |
| `pnpm format`                  | قالب‌بندی با Prettier        |
| `pnpm db:migrate:dev`          | ساخت Migration جدید در توسعه |
| `pnpm db:migrate`              | اعمال Migrationها (استقرار)  |

## ساختار

```text
apps/api        NestJS + Prisma (apps/api/prisma)
apps/web        Next.js
packages/contracts   Zod و انواع مشترک، ریال صحیح
packages/i18n        پیام‌های فارسی، تاریخ شمسی، قالب مبلغ
packages/ui          توکن‌های Design System
packages/config      tsconfig مشترک
deploy          Docker Compose
docs            ADR و مستندات امنیتی
```

## وضعیت

فاز ۰ (زیرساخت) در حال تکمیل است؛ جزئیات در `docs/phase-0.md`.
