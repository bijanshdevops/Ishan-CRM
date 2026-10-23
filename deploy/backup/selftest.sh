#!/bin/sh
# End-to-end proof that backups are restorable (ADR 0025). Needs a migrated source database
# (PGHOST/PGUSER/PGPASSWORD/PGDATABASE) and a role allowed to create databases.
# Run by CI after the full stack is up; also runnable by hand against a staging copy.
set -eu
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${PGDATABASE:?PGDATABASE is required}"
DIR="$(mktemp -d)"
RESTORED="${SRC}_selftest_restored"
trap 'psql -XAtq -d postgres -c "DROP DATABASE IF EXISTS \"$RESTORED\" WITH (FORCE)" >/dev/null 2>&1 || true; psql -XAtq -d "$SRC" -c "DROP TABLE IF EXISTS backup_selftest" >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
export BACKUP_DIR="$DIR/backups"
fail() { echo "selftest: FAIL - $1" >&2; exit 1; }
step() { echo "selftest: $1"; }

# A marker table with awkward values: Persian text, a BigInt beyond 2^53 (money is BigInt rials), UTC time.
psql -Xq -v ON_ERROR_STOP=1 -d "$SRC" <<'SQL'
DROP TABLE IF EXISTS backup_selftest;
CREATE TABLE backup_selftest (id integer PRIMARY KEY, note text NOT NULL, rials bigint NOT NULL, at timestamptz NOT NULL);
INSERT INTO backup_selftest VALUES (1, 'پیش‌فاکتور ۱۴۰۵ — تست', 9007199254740993, '2026-10-23 12:00:00+00');
SQL

step "1/6 plain backup -> restore into a new database -> identical content"
"$HERE/backup.sh"
file="$(ls "$BACKUP_DIR"/*.dump)"
"$HERE/restore.sh" "$file" "$RESTORED"
# Data: byte-identical (the random \restrict token pg_dump prints is the only expected difference).
data() { pg_dump --format=plain --data-only --no-owner --no-privileges "$1" | grep -v -E '^\\(un)?restrict '; }
data "$SRC" > "$DIR/src.sql"
data "$RESTORED" > "$DIR/restored.sql"
[ -s "$DIR/src.sql" ] || fail "the data dump of the source is empty"
diff -q "$DIR/src.sql" "$DIR/restored.sql" >/dev/null || { diff "$DIR/src.sql" "$DIR/restored.sql" | head -20 >&2; fail "restored data differs from the source"; }
# Structure: same columns, indexes and constraints (PostgreSQL re-prints some CHECK expressions with
# different parentheses after a restore, so constraints are compared by name and kind, not by text).
shape() {
  psql -XAtq -d "$1" <<'SQL'
SELECT 'col', table_name, column_name, data_type, is_nullable, coalesce(column_default, '')
  FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL SELECT 'idx', tablename, indexname, indexdef, '', '' FROM pg_indexes WHERE schemaname = 'public'
UNION ALL SELECT 'con', conrelid::regclass::text, conname, contype::text, '', '' FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
ORDER BY 1, 2, 3, 4;
SQL
}
shape "$SRC" > "$DIR/src.shape"
shape "$RESTORED" > "$DIR/restored.shape"
[ -s "$DIR/src.shape" ] || fail "the schema fingerprint of the source is empty"
diff -q "$DIR/src.shape" "$DIR/restored.shape" >/dev/null || { diff "$DIR/src.shape" "$DIR/restored.shape" | head -20 >&2; fail "restored schema differs from the source"; }
got="$(psql -XAtq -d "$RESTORED" -c "SELECT rials || ':' || note FROM backup_selftest WHERE id = 1")"
[ "$got" = "9007199254740993:پیش‌فاکتور ۱۴۰۵ — تست" ] || fail "marker row changed: $got"
src_migs="$(psql -XAtq -d "$SRC" -c 'SELECT count(*) FROM _prisma_migrations')"
rest_migs="$(psql -XAtq -d "$RESTORED" -c 'SELECT count(*) FROM _prisma_migrations')"
[ "$src_migs" = "$rest_migs" ] && [ "$src_migs" -gt 0 ] || fail "migration history differs ($src_migs vs $rest_migs)"

step "2/6 restoring over an existing database needs --replace and the database name"
if "$HERE/restore.sh" "$file" "$RESTORED" 2>/dev/null; then fail "restore overwrote an existing database without --replace"; fi
if "$HERE/restore.sh" "$file" "$RESTORED" --replace 2>/dev/null; then fail "--replace worked without --confirm"; fi
"$HERE/restore.sh" "$file" "$RESTORED" --replace --confirm "$RESTORED" >/dev/null

step "3/6 a corrupted backup is refused"
cp "$file" "$DIR/corrupt.dump"
printf '%s  corrupt.dump\n' "$(cut -d' ' -f1 "$file.sha256")" > "$DIR/corrupt.dump.sha256"
printf 'X' | dd of="$DIR/corrupt.dump" bs=1 seek=100 conv=notrunc 2>/dev/null
if "$HERE/restore.sh" "$DIR/corrupt.dump" "${RESTORED}_x" 2>"$DIR/err.txt"; then fail "a corrupted backup was restored"; fi
grep -q "CHECKSUM MISMATCH" "$DIR/err.txt" || fail "corruption was not reported as a checksum mismatch"
rm -f "$DIR/corrupt.dump" "$DIR/corrupt.dump.sha256"

step "4/6 encrypted backup round trip, and a wrong passphrase is refused"
printf '%s' "selftest-passphrase-not-a-secret" > "$DIR/pass"; printf '%s' "wrong-passphrase" > "$DIR/wrong"
sleep 1
BACKUP_PASSPHRASE_FILE="$DIR/pass" "$HERE/backup.sh"
enc="$(ls "$BACKUP_DIR"/*.dump.enc)"
if grep -aq 'PGDMP' "$enc"; then fail "the encrypted file still contains a readable archive header"; fi
if BACKUP_PASSPHRASE_FILE="$DIR/wrong" "$HERE/restore.sh" "$enc" "${RESTORED}_x" 2>/dev/null; then fail "wrong passphrase restored"; fi
BACKUP_PASSPHRASE_FILE="$DIR/pass" "$HERE/restore.sh" "$enc" "$RESTORED" --replace --confirm "$RESTORED" >/dev/null
[ "$(psql -XAtq -d "$RESTORED" -c 'SELECT count(*) FROM backup_selftest')" = 1 ] || fail "encrypted restore lost the marker row"

step "5/6 tiered retention: recent backups all kept, older ones thin to one per day, expired ones go"
# Fake backups named and dated like real ones, relative to now: stamp N days ago at hour H.
now_s="$(date +%s)"
fake() { # fake DAYS_AGO HOUR
  ts=$((now_s - $1 * 86400))
  day="$(date -u -d "@$ts" +%Y%m%d)"
  name="$SRC-${day}T$(printf '%02d' "$2")0000Z.dump"
  : > "$BACKUP_DIR/$name"; : > "$BACKUP_DIR/$name.sha256"
  touch -d "$(date -u -d "@$ts" '+%Y-%m-%d') $(printf '%02d' "$2"):00:00" "$BACKUP_DIR/$name" "$BACKUP_DIR/$name.sha256"
  echo "$name"
}
rm -f "$BACKUP_DIR"/*
r1a="$(fake 1 3)"; r1b="$(fake 1 15)"           # inside the hourly window: both kept
d3a="$(fake 3 1)"; d3b="$(fake 3 13)"           # older, same day: only the newest survives
d5="$(fake 5 7)"                                # older, its own day: kept
x20a="$(fake 20 3)"; x20b="$(fake 20 4)"        # past RETENTION_DAYS: both removed
sleep 1
HOURLY_KEEP_DAYS=2 RETENTION_DAYS=14 MIN_KEEP=1 "$HERE/backup.sh" >/dev/null
for kept in "$r1a" "$r1b" "$d3b" "$d5"; do
  [ -e "$BACKUP_DIR/$kept" ] || fail "retention removed $kept, which it must keep"
done
for gone in "$d3a" "$x20a" "$x20b"; do
  [ ! -e "$BACKUP_DIR/$gone" ] && [ ! -e "$BACKUP_DIR/$gone.sha256" ] || fail "retention kept $gone, which it must remove"
done
[ "$(ls "$BACKUP_DIR"/"$SRC"-*.dump | wc -l)" = 5 ] || fail "unexpected number of backups after pruning"
# The MIN_KEEP floor wins over age: even expired backups stay while they are among the newest.
rm -f "$BACKUP_DIR"/*
e1="$(fake 30 2)"; e2="$(fake 31 2)"; e3="$(fake 32 2)"
sleep 1
HOURLY_KEEP_DAYS=2 RETENTION_DAYS=14 MIN_KEEP=3 "$HERE/backup.sh" >/dev/null
[ ! -e "$BACKUP_DIR/$e3" ] || fail "the oldest expired backup survived although three newer ones exist"
[ -e "$BACKUP_DIR/$e1" ] && [ -e "$BACKUP_DIR/$e2" ] || fail "MIN_KEEP did not protect the newest expired backups"

step "6/6 a backup of an unreachable database fails loudly and leaves no partial file"
before="$(ls -A "$BACKUP_DIR" | wc -l)"
if PGHOST=127.0.0.1 PGPORT=1 "$HERE/backup.sh" 2>/dev/null; then fail "a backup of an unreachable server reported success"; fi
[ "$(ls -A "$BACKUP_DIR" | wc -l)" = "$before" ] || fail "a failed backup left files behind"

echo "selftest: PASS (backup, verify, restore, encryption, retention, failure paths)"
