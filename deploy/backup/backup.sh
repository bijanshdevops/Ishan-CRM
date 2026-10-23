#!/bin/sh
# Logical backup of the Ishan PostgreSQL database (ADR 0025).
#
# Connection: standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
# Settings:
#   BACKUP_DIR              where backups go (default /backups)
#   RETENTION_DAYS          delete backups older than this many days (default 14)
#   MIN_KEEP                never prune below this many newest backups (default 3)
#   BACKUP_PASSPHRASE_FILE  optional; encrypts the dump with AES-256 (openssl, PBKDF2)
set -eu
umask 077

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_KEEP="${MIN_KEEP:-3}"

case "$RETENTION_DAYS$MIN_KEEP" in
  *[!0-9]*) echo "backup: RETENTION_DAYS and MIN_KEEP must be whole numbers" >&2; exit 2 ;;
esac
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ] && [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
  echo "backup: BACKUP_PASSPHRASE_FILE is set but missing or empty" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="$PGDATABASE-$stamp.dump"
work="$BACKUP_DIR/.tmp-$stamp-$$"
mkdir "$work"
trap 'rm -rf "$work"' EXIT INT TERM

# 1. Dump (custom format: compressed, restorable selectively). Ownership/privileges are not
#    carried over so the dump restores under any role.
pg_dump --format=custom --no-owner --no-privileges --file="$work/$name"

# 2. The archive must at least be readable and non-trivial before it replaces anything.
entries="$(pg_restore --list "$work/$name" | grep -c 'TABLE DATA' || true)"
if [ "$entries" -lt 1 ]; then
  echo "backup: the dump contains no table data; refusing to keep it" >&2
  exit 1
fi

# 3. Optional encryption at rest.
final="$name"
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  final="$name.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
    -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$work/$name" -out "$work/$final"
  rm -f "$work/$name"
fi

# 4. Checksum of exactly the file that is stored.
(cd "$work" && sha256sum "$final" > "$final.sha256")

# 5. Publish: the data file first, the checksum last, so a listed checksum implies a complete backup.
if [ -e "$BACKUP_DIR/$final" ]; then
  echo "backup: $final already exists; wait a second and retry" >&2
  exit 1
fi
mv "$work/$final" "$BACKUP_DIR/$final"
mv "$work/$final.sha256" "$BACKUP_DIR/$final.sha256"
size="$(wc -c < "$BACKUP_DIR/$final" | tr -d ' ')"
echo "backup: ok file=$final bytes=$size tables_with_data=$entries encrypted=$([ "$final" != "$name" ] && echo yes || echo no)"

# 6. Retention: delete files older than RETENTION_DAYS, but always keep the MIN_KEEP newest, so a
#    stalled scheduler or a wrong clock can never prune the last good backups.
pruned=0
# shellcheck disable=SC2012
for f in $(ls -1t "$BACKUP_DIR" | grep -E '\.dump(\.enc)?$' | tail -n +"$((MIN_KEEP + 1))"); do
  if [ -n "$(find "$BACKUP_DIR/$f" -mtime +"$RETENTION_DAYS" 2>/dev/null)" ]; then
    rm -f "$BACKUP_DIR/$f" "$BACKUP_DIR/$f.sha256"
    pruned=$((pruned + 1))
  fi
done
echo "backup: pruned=$pruned retention_days=$RETENTION_DAYS min_keep=$MIN_KEEP"
