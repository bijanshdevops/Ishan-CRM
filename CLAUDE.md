# Ishan CRM — conventions for agents

- Monorepo: pnpm + Turborepo. Run `pnpm typecheck && pnpm test && pnpm build` before claiming done.
- API is NestJS 11 + Prisma 7 in `apps/api` (schema in `apps/api/prisma`). Money = integer rials (BigInt); time = UTC.
- UI is Persian/RTL first: use logical CSS properties, tokens from `@ishan/ui`, strings from `@ishan/i18n`.
- No demo data in production; every endpoint needs authorization tests. Follow `docs/adr`.
- A phase is done only when the Definition of Done in the architecture doc is met with evidence.
