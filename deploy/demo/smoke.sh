#!/bin/sh
# Proves the live demo behaves as designed (ADR 0026). Usage: smoke.sh BASE_URL [reset-command...]
#   BASE_URL  e.g. http://127.0.0.1:3100  (the web container, path prefix /demo is added here)
#   the rest  command that runs one demo reset (default: docker compose exec on the demo stack)
set -eu
BASE="${1:?base url}"; shift || true
API="$BASE/demo/api/v1"
ORIGIN="https://ishan.greenlanco.ir"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
fail() { echo "demo-smoke: FAIL - $1" >&2; exit 1; }
ok() { echo "demo-smoke: ok - $1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
get() { curl -sf -b "$JAR" -c "$JAR" "$@"; }
post() { curl -s -b "$JAR" -c "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -X POST "$@"; }

# Wait for the web app and the first data load.
i=0; until [ "$(code "$BASE/demo/login")" = 200 ]; do i=$((i+1)); [ $i -lt 60 ] || fail "web did not come up"; sleep 2; done
ok "the login route answers under /demo"
curl -sf "$BASE/demo/login" | grep -q '/demo/_next/' || fail "assets are not served under /demo"
ok "assets are served under /demo"

[ "$(curl -sf "$API/demo/info" | jq -r .demo)" = true ] || fail "/demo/info does not report demo mode"
[ "$(code "$BASE/demo/api/v1/customers")" = 401 ] || fail "data is readable without a session"
ok "no data without a session"

i=0; while :; do
  r="$(curl -s -w '\n%{http_code}' -b "$JAR" -c "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -X POST "$API/demo/session")"
  # Right after start the reset may not have created the demo user yet: retry until the data shows up.
  if [ "$(printf '%s' "$r" | tail -n 1)" != 200 ]; then
    i=$((i+1)); [ $i -lt 60 ] || fail "auto-login failed: $r"; sleep 3; continue
  fi
  n="$(get "$API/customers?limit=50" | jq '.items | length')"
  [ "$n" -gt 0 ] && break
  i=$((i+1)); [ $i -lt 60 ] || fail "the demo data was never loaded"; sleep 3
done
ok "auto-login works and the fictional data is loaded ($n customers)"

role="$(get "$API/auth/me" | jq -r .role.key)"
[ "$role" = demo ] || fail "visitor has role '$role', expected the restricted demo role"
ok "visitor runs as the restricted demo role"

for path in users roles audit webhooks; do
  [ "$(code -b "$JAR" "$API/$path")" = 403 ] || fail "$path is reachable by the demo visitor"
done
ok "user, role, audit and webhook management are closed"
[ "$(code -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -X POST -d '{"url":"https://example.com/h","events":["customer.created"]}' "$API/webhooks")" = 403 ] || fail "a webhook could be created"
r="$(post -d '{"currentPassword":"x","newPassword":"Another-Passw0rd-123"}' "$API/auth/change-password")"
echo "$r" | grep -q DEMO_RESTRICTED || fail "the shared account's password could be changed: $r"
[ "$(code -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -X POST "$API/auth/mfa/setup")" = 403 ] || fail "MFA could be set up on the shared account"
ok "credentials of the shared account cannot be changed"

# Free writing, then the hourly reset puts the data back.
post -d '{"kind":"PERSON","name":"مشتری آزمایشی دمو"}' "$API/customers" | jq -e .id >/dev/null || fail "visitors cannot create a customer"
get -G --data-urlencode "q=آزمایشی" "$API/customers" | jq -e '.items | length >= 1' >/dev/null || fail "the new customer is not listed"
ok "visitors can write freely"
if [ $# -gt 0 ]; then "$@" >/dev/null 2>&1 || fail "the reset command failed"; else
  docker compose -f deploy/compose.demo.yml --env-file "${DEMO_ENV_FILE:-deploy/demo.env}" exec -T reset node dist/modules/demo/reset-cli.js >/dev/null 2>&1 || fail "the reset command failed"
fi
[ "$(get -G --data-urlencode "q=آزمایشی" "$API/customers" | jq '.items | length')" = 0 ] || fail "the reset kept the visitor's data"
[ "$(get "$API/customers?limit=50" | jq '.items | length')" -gt 0 ] || fail "the reset left the demo empty"
[ "$(get "$API/auth/me" | jq -r .role.key)" = demo ] || fail "the reset signed the visitor out"
ok "the reset removes visitor data, restores the fictional data and keeps sessions"
echo "demo-smoke: PASS"
