#!/bin/sh
# Healthy while the newest backup is younger than twice the interval (plus a grace period for the first run).
set -eu
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
max_min=$(( (interval * 2) / 60 + 5 ))
[ -n "$(find "${BACKUP_DIR:-/backups}" -maxdepth 1 -name '*.sha256' -mmin "-$max_min" 2>/dev/null)" ]
