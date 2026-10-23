#!/bin/sh
# Restore an Ishan backup made by backup.sh into a PostgreSQL database (ADR 0025).
#
#   restore.sh BACKUP_FILE TARGET_DB                       # target must NOT exist (created)
#   restore.sh BACKUP_FILE TARGET_DB --replace --confirm TARGET_DB   # drop and recreate it
#
# Connection: libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD) of a role that can create
# databases. PGDATABASE is ignored; administration runs against the "postgres" database.
# BACKUP_PASSPHRASE_FILE is required for *.enc files.
set -eu
umask 077

usage() { echo "usage: restore.sh BACKUP_FILE TARGET_DB [--replace --confirm TARGET_DB]" >&2; exit 2; }
[ "$#" -ge 2 ] || usage
file="$1"; target="$2"; shift 2
replace=no; confirm=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --replace) replace=yes ;;
    --confirm) shift; [ "$#" -gt 0 ] || usage; confirm="$1" ;;
    *) usage ;;
  esac
  shift
done

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
case "$target" in
  *[!a-zA-Z0-9_]*|"") echo "restore: TARGET_DB may only contain letters, digits and underscore" >&2; exit 2 ;;
esac
[ -f "$file" ] || { echo "restore: $file not found" >&2; exit 2; }
if [ "$replace" = yes ] && [ "$confirm" != "$target" ]; then
  echo "restore: --replace destroys the existing '$target'; repeat the name with --confirm $target" >&2
  exit 2
fi

# 1. Integrity: the checksum written at backup time must match the file we are about to use.
[ -f "$file.sha256" ] || { echo "restore: $file.sha256 is missing; refusing an unverified file" >&2; exit 1; }
dir="$(dirname "$file")"; base="$(basename "$file")"
(cd "$dir" && sha256sum -c "$base.sha256" >/dev/null) \
  || { echo "restore: CHECKSUM MISMATCH for $base; the file is corrupted or was modified" >&2; exit 1; }

# 2. Decrypt into a private temp dir if needed.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM
archive="$file"
case "$file" in
  *.enc)
    [ -n "${BACKUP_PASSPHRASE_FILE:-}" ] && [ -s "$BACKUP_PASSPHRASE_FILE" ] \
      || { echo "restore: set BACKUP_PASSPHRASE_FILE to restore an encrypted backup" >&2; exit 2; }
    archive="$work/restore.dump"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$BACKUP_PASSPHRASE_FILE" \
      -in "$file" -out "$archive" \
      || { echo "restore: decryption failed (wrong passphrase or corrupted file)" >&2; exit 1; }
    ;;
esac
pg_restore --list "$archive" >/dev/null \
  || { echo "restore: not a valid PostgreSQL archive" >&2; exit 1; }

# 3. Prepare the target database.
export PGDATABASE=postgres
exists="$(psql -XAtq -c "SELECT 1 FROM pg_database WHERE datname = '$target'")"
if [ "$exists" = 1 ]; then
  [ "$replace" = yes ] || { echo "restore: database '$target' already exists (use --replace --confirm $target)" >&2; exit 1; }
  psql -Xq -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$target\" WITH (FORCE)"
fi
psql -Xq -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$target\""

# 4. Restore everything in one transaction: it either fully applies or leaves the new database empty.
if ! pg_restore --dbname="$target" --no-owner --no-privileges --exit-on-error --single-transaction "$archive"; then
  echo "restore: FAILED; '$target' was created but is empty/incomplete and must not be used" >&2
  exit 1
fi

# 5. Report enough to eyeball.
PGDATABASE="$target" psql -XAtq -c "ANALYZE"
tables="$(PGDATABASE="$target" psql -XAtq -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
migrations="$(PGDATABASE="$target" psql -XAtq -c "SELECT count(*) FROM _prisma_migrations" 2>/dev/null || echo n/a)"
echo "restore: ok database=$target tables=$tables migrations=$migrations source=$base"
