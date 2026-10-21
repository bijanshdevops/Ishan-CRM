# Campaign e-mail (ADR 0015)

One e-mail send per campaign, to customers (and their primary contact) matching a tag filter.
Needs the SMTP settings of `docs/email-notifications.md`; without `SMTP_HOST` the feature is off.

## Extra configuration

| Variable                            | Meaning                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `CAMPAIGN_EMAIL_FROM`               | Sender of marketing mail; defaults to `EMAIL_FROM`. A separate identity protects the reputation of notification mail. |
| `CAMPAIGN_EMAIL_PER_MINUTE`         | Send rate of the `campaign-emails` worker (default 60, concurrency 1).                                                |
| `CAMPAIGN_RECIPIENT_RETENTION_DAYS` | Finished recipient rows (copied addresses) are purged after this many days (default 180).                             |

## Flow

1. Save the text (`PUT /campaigns/:id/sending`): subject, plain-text body, audience. Only `{{customerName}}` is a merge field.
2. Preview (`POST .../preview`): number of recipients and how many were left out as suppressed.
3. Optional test mail to your own verified address (`POST .../test`, no unsubscribe link).
4. Start (`POST .../start`, permission `campaigns.send`, admin only) with the number seen in the preview; a different current count answers 409.
5. Cancel (`POST .../cancel`) skips everything not yet sent.

## Unsubscribe

Every mail carries a signed link and `List-Unsubscribe` / `List-Unsubscribe-Post` headers (RFC 8058). The token is `base64url({org,email}).HMAC` keyed from `ENCRYPTION_KEY`, so links keep working after recipient rows are purged — **rotating `ENCRYPTION_KEY` invalidates old links**. A hard bounce (`550 5.1.1`) suppresses the address too. The suppression list is never purged; admins and sales managers can add or remove entries.

## Troubleshooting

`SELECT status, count(*) FROM campaign_recipients WHERE campaign_id = '…' GROUP BY 1;` and `last_error` on failed rows.
