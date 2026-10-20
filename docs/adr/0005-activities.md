# ADR 0005 — Activities, reminders and the interaction history

- Status: accepted (phase 4)

## Context

Sales work is a stream of calls, meetings, tasks and notes tied to customers, contacts and deals. The
CRM needs a task list, a calendar, reminders and a chronological history on the customer file.

## Decision

1. **One `activities` table** with `type` (CALL, MEETING, TASK, NOTE) and `status` (PLANNED, DONE,
   CANCELED). The task list, the calendar and the customer timeline are _views_ over it, so they can
   never disagree. Notes are DONE activities without a schedule.
2. **Rules live in two places on purpose.** `checkActivityShape` in `@ishan/contracts` is the single
   source for API and UI validation; the database re-enforces the invariants that must never break
   (`CHECK` constraints: notes are unscheduled and done, planned work has `due_at`, done work has
   `completed_at`, `end_at >= due_at`).
3. **Time:** `due_at` is the start (calls/meetings) or deadline (tasks); `completed_at` is when the
   interaction actually happened and is the timeline's ordering key. All instants are UTC
   `timestamptz`; Jalali and Tehran wall-clock conversion happen only in the UI (`@ishan/i18n`).
4. **Ownership:** everyone with `activities.read` can see activities of the organization (the customer
   file needs the shared history). Changing one requires being its assignee or creator, or holding
   `activities.manage_all`. Hard deletion needs `activities.delete`; others cancel instead.
5. **Reminders are in-app.** `remind_at` + `reminder_dismissed_at`; the signed-in user's due reminders
   are served by `GET /activities/reminders/due` and polled by the UI (60 s and on focus). No
   background worker or outbound channel exists yet, so we do not claim email/SMS delivery. Moving the
   reminder re-arms it; completing or canceling clears it.
6. **Timeline** = finished activities of the customer + stage changes of its deals (the latter only for
   users who can read deals), merged newest first and paged by timestamp (`before`).
7. **Soft delete** like other domain tables; activities of a soft-deleted customer are hidden with it.

## Consequences

- No recurring activities, attendees list, external calendar sync or email/SMS reminders yet; these
  need a worker/queue and are separate decisions.
- Timeline paging by timestamp can, in theory, skip an item sharing the exact millisecond of a page
  boundary; acceptable for a history feed.
- Search over activity text uses normalized `contains` like the other modules (pg_trgm deferred).
