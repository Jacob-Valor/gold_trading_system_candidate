#!/usr/bin/env bash
# Smoke test: exercises the full user journey against a running instance.
# Usage: BASE_URL=${BASE_URL:-http://localhost:3000} bash scripts/smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
JQ="${JQ:-jq}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v "$JQ" >/dev/null || { echo "$JQ is required" >&2; exit 1; }

EMAIL="smoke-$$-$RANDOM-$(date +%s%N)@example.com"
PASSWORD="Smoke123!"
cleanup_test_user() {
  npx --no-install tsx scripts/cleanup-test-data.ts "$EMAIL" >/dev/null 2>&1 || true
}
trap cleanup_test_user EXIT

jqget() { $JQ -r "$2" <<<"$1"; }
jqok() { $JQ -e "$2" >/dev/null <<<"$1"; }

echo "== Register =="
REG=$(curl -sS -X POST "$BASE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke User\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
jqok "$REG" '.data.token'
TOKEN=$(jqget "$REG" '.data.token')
echo "Token: ${TOKEN:0:20}..."
USERID=$(jqget "$REG" '.data.user.id')

echo "== Deposit 1000 USD =="
DEP=$(curl -sS -X POST "$BASE_URL/api/wallet/deposit" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":1000,"currency":"USD"}')
jqok "$DEP" '.data.balanceAfter == "1000.00"'
echo "OK balance=$(jqget "$DEP" '.data.balanceAfter')"

echo "== View balance =="
BAL=$(curl -sS "$BASE_URL/api/wallet" -H "Authorization: Bearer $TOKEN")
jqok "$BAL" '.data.wallets | length >= 1'
echo "OK says $(jqget "$BAL" '.data.wallets[0].currency')"

echo "== Buy 5g gold =="
BUY=$(curl -sS -X POST "$BASE_URL/api/trades/buy" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"goldAmount":5,"currency":"USD"}')
jqok "$BUY" '.data.totalCost | tonumber > 0'
echo "OK trade=$(jqget "$BUY" '.data.tradeId') cost=$(jqget "$BUY" '.data.totalCost')"

echo "== Sell 2g gold =="
SELL=$(curl -sS -X POST "$BASE_URL/api/trades/sell" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"goldAmount":2,"currency":"USD"}')
jqok "$SELL" '.data.tradeId'
echo "OK trade=$(jqget "$SELL" '.data.tradeId')"

echo "== Withdraw (should succeed) =="
WD=$(curl -sS -X POST "$BASE_URL/api/wallet/withdraw" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":100,"currency":"USD"}')
jqok "$WD" '.data.balanceAfter | tonumber >= 0'
echo "OK balance=$(jqget "$WD" '.data.balanceAfter')"

echo "== Withdraw too much (should fail 422) =="
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/wallet/withdraw" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":999999999,"currency":"USD"}')
echo "Got HTTP $CODE (expected 422)"
[ "$CODE" = "422" ]

echo "== Transactions list =="
TX=$(curl -sS "$BASE_URL/api/wallet/transactions?page=1&pageSize=5" -H "Authorization: Bearer $TOKEN")
jqok "$TX" '.meta.pagination.total > 0'
echo "OK total=$(jqget "$TX" '.meta.pagination.total')"

echo "== Trades list =="
TR=$(curl -sS "$BASE_URL/api/trades?page=1&pageSize=5" -H "Authorization: Bearer $TOKEN")
jqok "$TR" '.meta.pagination.total >= 2'
echo "OK total=$(jqget "$TR" '.meta.pagination.total')"

echo "== Validation: bad email =="
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"email":"nope","password":"x"}')
echo "Got HTTP $CODE (expected 400)"
[ "$CODE" = "400" ]
ADMIN_EMAIL="${ADMIN_EMAIL:?Set ADMIN_EMAIL to the seeded admin email}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD to the seeded admin password}"
echo "== Admin login =="
ADM=$(curl -sS -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
jqok "$ADM" '.data.token'
ATOKEN=$(jqget "$ADM" '.data.token')

echo "== Admin: list users =="
USERS=$(curl -sS "$BASE_URL/api/admin/users?page=1&pageSize=5" -H "Authorization: Bearer $ATOKEN")
jqok "$USERS" '.data | length > 0'
echo "OK users=$(jqget "$USERS" '.meta.pagination.total')"

echo "== Admin: list transactions =="
TXS=$(curl -sS "$BASE_URL/api/admin/transactions?page=1&pageSize=5" -H "Authorization: Bearer $ATOKEN")
jqok "$TXS" '.meta.pagination.total > 0'

echo "== Soft delete: disable smoke user, login must fail =="
curl -sS -X DELETE "$BASE_URL/api/admin/users/$USERID" -H "Authorization: Bearer $ATOKEN" >/dev/null
DEL_BODY="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d "$DEL_BODY")
echo "Login after delete: HTTP $CODE (expected 401)"
[ "$CODE" = "401" ]

echo "== Rate limit check (login x15) =="
LOGIN_BODY="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
RL=0
for i in $(seq 1 15); do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/login" \
    -H 'Content-Type: application/json' -d "$LOGIN_BODY")
  if [ "$CODE" = "429" ]; then RL=1; break; fi
done
if [ "$RL" = "1" ]; then
  echo "OK rate-limited (429)"
else
  echo "ERROR: no 429 observed in 15 attempts" >&2
  exit 1
fi

echo "== All smoke checks passed =="