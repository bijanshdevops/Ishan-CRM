# ADR 0009 — Optimistic concurrency with ETag / If-Match

Status: accepted

## Context

Two people can open the same customer, lead or deal and save in turn; the second save silently
overwrites the first. A CRM is edited by teams, so this must be detected, not hoped away.

## Decision

- Every single-entity response that carries `id` and `updatedAt` gets an `ETag` header
  (`"<updated_at epoch ms>"`), added by one global interceptor. No new column: `updated_at`
  already changes on every write. `LeadDto` gained `updatedAt` for this.
- `PATCH /customers/:id`, `/leads/:id` and `/deals/:id` honour `If-Match`. A stale tag answers
  `412` with code `STALE_ENTITY`; a missing header, an empty one or `*` keeps last-write-wins, so
  API clients and scripts do not break.
- The check is also part of the write itself: with a concrete tag the UPDATE runs as
  `WHERE id = … AND updated_at ∈ [seen, seen + 1 ms)` and zero affected rows means 412. Two
  writers racing on the same tag therefore cannot both succeed. The one-millisecond window absorbs
  the microseconds PostgreSQL may hold beyond a JS `Date` (rows written by raw SQL).
- The web client sends the `updatedAt` of the entity the form was opened with as `version`, which
  `api()` turns into `If-Match`. This works for forms opened from list data too, so no extra read
  of the detail endpoint is needed. Customer edit, deal edit and lead status change use it.

## Consequences

- Update (phase 18): the same contract now covers `PATCH` of workflows, webhooks, **contacts,
  products, campaigns, activities, users, teams and roles**. Their DTOs gained `updatedAt` (teams
  and roles are plain objects). The guarded write is `updateMany` with `casWhere()` plus
  `assertWritten()` (zero rows: 412 when a tag was sent, otherwise the usual 404), followed by a
  re-read. A contact write is guarded before it demotes sibling primary contacts, in the same
  transaction, so a stale save changes nothing.
- Update (phase 22): tags, lead sources and pipeline stages gained an `updated_at` column (migration
  `config_updated_at`: nullable add, back-fill from `created_at`, then `NOT NULL`, so existing rows are
  valid and Prisma's `@updatedAt` takes over) and the same guard on their `PATCH`. Their DTOs carry
  `updatedAt`; `TagDto` and `StageDto` are embedded in customer and deal payloads, which now carry it
  too. Re-ordering the stages touches every stage, so a stage form opened before a re-order is
  refused once and reloads: the position it shows really did change.
- Still last-write-wins on purpose: quotes and contracts, which already version explicitly.
- A user's `updated_at` also moves on sign-in, so an admin form opened before the person logged in
  is refused once: the reload shows the fresh state. That is the correct signal, not noise.
- Quotes and contracts already version explicitly and are out of scope.
- Tests: unit (`etag.spec.ts`, `api.test.ts`) and database tests for customers, leads and deals,
  including a two-writer race on one tag.
