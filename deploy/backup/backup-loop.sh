#!/bin/sh
# Scheduler for the compose "backup" service: one backup every BACKUP_INTERVAL_SECONDS.
# A failed run is logged and retried next cycle; the healthcheck turns a stale backup into an alarm.
set -u
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
while true; do
  /usr/local/bin/backup.sh || echo "backup: FAILED at $(date -u +%FT%TZ)" >&2
  sleep "$interval"
done
