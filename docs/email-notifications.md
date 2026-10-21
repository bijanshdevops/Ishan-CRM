# E-mail notifications (ADR 0013)

Optional channel: when a user opts in, every in-app notification (workflow `notify` actions and
system notices such as an auto-disabled webhook) is also sent to the e-mail address of their account.

## Configuration

| Variable                        | Meaning                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `SMTP_HOST`                     | Enables the channel. Unset = no e-mail is queued and the account switch is hidden.       |
| `SMTP_PORT`                     | Default `587` (STARTTLS). Use `465` with `SMTP_SECURE=true` for implicit TLS.            |
| `SMTP_SECURE`                   | `true` = implicit TLS. Otherwise STARTTLS is **required**; there is no silent downgrade. |
| `SMTP_USER`, `SMTP_PASSWORD`    | Set together, or both unset.                                                             |
| `EMAIL_FROM`                    | Sender, e.g. `Ishan <noreply@example.com>`. Required with `SMTP_HOST`.                   |
| `APP_BASE_URL`                  | Public URL of the web app, used for the link in each e-mail. Required with `SMTP_HOST`.  |
| `SMTP_ALLOW_INSECURE`           | Dev/test only: plain SMTP. Ignored when `NODE_ENV=production`.                           |
| `EMAIL_DELIVERY_RETENTION_DAYS` | Finished delivery rows are purged after this many days (default 30).                     |

The worker process (not the API) sends e-mail, so it needs the same SMTP variables.

## Behaviour

- Off by default per user; each user switches it on under their account settings.
- The e-mail row is written in the same transaction as the notification (outbox), so a notification
  is never lost or duplicated by a crash.
- Retries: 5 attempts, waiting 1, 10, 60 and 360 minutes. A permanent 5xx reply fails at once.
- At most 30 e-mails per user per hour; the rest are marked `SKIPPED` (the in-app notification stays).
- Recipients that were disabled or opted out after queueing are skipped.
- The address is always read from the user record at send time; it is never copied.
- `POST /api/v1/account/notification-email/test` sends a sample to the caller (5 per hour).

## Troubleshooting

`SELECT status, attempt, last_error FROM email_deliveries ORDER BY created_at DESC LIMIT 20;`
`last_error` holds the SMTP reply (never credentials). `FAILED` rows are not retried automatically.
