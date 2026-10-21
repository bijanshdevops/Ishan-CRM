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

- Other PATCH endpoints (contacts, tags, products, campaigns, users, activities) are not guarded
  yet; adding one is a `ifMatch` parameter plus the same two helpers.
- Quotes and contracts already version explicitly and are out of scope.
- Tests: unit (`etag.spec.ts`, `api.test.ts`) and database tests for customers, leads and deals,
  including a two-writer race on one tag.
