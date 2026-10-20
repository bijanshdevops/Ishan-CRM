# ADR 0009 — Optimistic concurrency with ETag / If-Match

Status: accepted

## Context
Two people can open the same customer, lead or deal and save in turn; the second save silently
overwrites the first. A CRM is edited by teams, so this must be detected, not hoped away.

## Decision
- Every single-entity response that carries `id` and `updatedAt` gets an `ETag` header
  (`"<updated_at epoch ms>"`), added by one global interceptor. No new column: `updated_at`
  already changes on every write.
- `PATCH /customers/:id`, `/leads/:id` and `/deals/:id` honour `If-Match`. A stale tag answers
  `412` with code `STALE_ENTITY`; a missing header or `*` keeps last-write-wins, so API clients
  and scripts do not break.
- The web client remembers the tag of each entity it read (`GET`/`PATCH`) and sends it on the next
  `PATCH`; any other successful write to the entity or its children forgets the tag so the user's
  own actions never cause a false conflict.

## Consequences
- Pages that edit from list data without reading the detail endpoint send no `If-Match` and stay
  last-write-wins until they read the entity; moving them to the detail read is incremental.
- The check is read-then-write inside one request, not a database compare-and-set, so a conflict
  in the few milliseconds between the two is still possible. Closing that window needs
  `UPDATE … WHERE updated_at = $tag`, tracked as a follow-up.
- Quotes and contracts already version explicitly and are out of scope.
