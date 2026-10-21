# Quote PDF and e-mail (ADR 0016)

## Requirements

- **PDF:** headless Chromium. The API image installs `chromium` and an Arabic font and sets
  `PDF_CHROMIUM_PATH=/usr/bin/chromium`. Outside Docker, install Chrome/Chromium and set
  `PDF_CHROMIUM_PATH` to its path. Without it `GET /quotes/:id/pdf` answers 503 `pdf_unavailable`
  and the browser print button keeps working.
- **E-mail:** the SMTP settings of `docs/email-notifications.md` (`SMTP_HOST`, `EMAIL_FROM`, `APP_BASE_URL`).
  Sending also needs the PDF renderer, because the PDF is attached when the worker sends.
- The worker image must have the same Chromium (it renders the attachment).

## API

| Method | Path                                | Permission     | Notes                                                        |
| ------ | ----------------------------------- | -------------- | ------------------------------------------------------------ |
| GET    | `/quotes/:id/pdf`                   | `quotes.read`  | `application/pdf`, attachment, `no-store`; nothing is stored |
| GET    | `/quotes/:id/email-options`         | `quotes.write` | allowed recipients, verified Reply-To, availability flags    |
| GET    | `/quotes/:id/emails`                | `quotes.read`  | last 50 sends of this version                                |
| POST   | `/quotes/:id/emails`                | `quotes.write` | `{ to, message? }` → 202; queued, the worker sends           |
| POST   | `/quotes/:id/emails/:emailId/retry` | `quotes.write` | only a `FAILED` e-mail; fresh set of attempts                |

Rules: only `SENT` and `ACCEPTED` quotes; `to` must be the customer's or the quote contact's address on file
(400 `recipient_not_allowed`); the sender needs a verified address (409 `email_not_verified`), which becomes
Reply-To; 20 e-mails per user per hour (429 `rate_limited`); one pending e-mail per quote and recipient
(409 `already_queued`).

## Delivery

A row in `quote_emails` is the outbox. The minutely sweeper hands due rows to the `emails` queue; the worker
claims a row with a conditional update (one sender), renders the PDF, sends, and records the result. Five
attempts with 1/10/60/360 minute backoff; a permanent 5xx reply or a quote that is no longer sendable fails
at once. Typical latency is under a minute. Finished rows are kept as business records.

## Troubleshooting

- _503 `pdf_unavailable`:_ `PDF_CHROMIUM_PATH` is unset or the file does not exist.
- _E-mail stays `PENDING`:_ the worker is not running or has no Chromium; check its log for `quote email failed`.
- _Blank or boxed Persian text in the PDF:_ the font file did not load; the template embeds Vazirmatn from
  the `vazirmatn` package, so reinstall dependencies.
