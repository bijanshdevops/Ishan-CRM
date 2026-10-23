#!/bin/sh
# Recovery drill: times a real backup and a real restore of PGDATABASE and prints the figures that
# make up RTO (ADR 0025). Safe to run against a copy of production: it only reads the source, and
# restores into the throw-away database "<PGDATABASE>_rto_drill", which it drops at the end.
# Set BACKUP_PASSPHRASE_FILE to include decryption in the measurement.
set -eu
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${PGDATABASE:?PGDATABASE is required}"
TARGET="${SRC}_rto_drill"
export BACKUP_DIR="$(mktemp -d)"
trap 'psql -XAtq -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)" >/dev/null 2>&1 || true; rm -rf "$BACKUP_DIR"' EXIT

now() { date +%s; }
size_pretty() { psql -XAtq -d "$1" -c "SELECT pg_size_pretty(pg_database_size(current_database()))"; }

db_size="$(size_pretty "$SRC")"
t0="$(now)"; "$HERE/backup.sh" >/dev/null; t1="$(now)"
file="$(ls "$BACKUP_DIR"/ishan-*.dump* 2>/dev/null | grep -v '\.sha256$' | head -1)"
[ -n "$file" ] || file="$(ls "$BACKUP_DIR"/*.dump* | grep -v '\.sha256$' | head -1)"
file_bytes="$(wc -c < "$file" | tr -d ' ')"
t2="$(now)"; "$HERE/restore.sh" "$file" "$TARGET" >/dev/null; t3="$(now)"
t4="$(now)"
mig_src="$(psql -XAtq -d "$SRC" -c 'SELECT count(*) FROM _prisma_migrations' 2>/dev/null || echo n/a)"
mig_dst="$(psql -XAtq -d "$TARGET" -c 'SELECT count(*) FROM _prisma_migrations' 2>/dev/null || echo n/a)"

echo "database size        : $db_size"
echo "backup file          : $(( file_bytes / 1048576 )) MiB ($(basename "$file" | sed 's/[0-9TZ]\{16\}/<ts>/'))"
echo "backup time (RPO job): $(( t1 - t0 )) s"
echo "restore time (RTO)   : $(( t3 - t2 )) s   (checksum + decrypt + restore + ANALYZE)"
echo "migrations src/dst   : $mig_src / $mig_dst"
[ "$mig_src" = "$mig_dst" ] || { echo "rto-drill: FAIL - migration history differs" >&2; exit 1; }
echo "rto-drill: ok (add the time to fetch the file from off-site storage and to switch the application over)"
