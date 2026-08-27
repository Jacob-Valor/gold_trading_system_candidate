# Gold Trading System

Backend developer candidate task — a REST backend for a gold trading platform with account management, multi-currency wallets and gold settlement, administrative controls, search, pagination, soft deletion, rate limiting, and broadcasts.

Built with **Next.js App Router Route Handlers**, **TypeScript**, **Prisma**, and **PostgreSQL**, with Docker support and an end-to-end smoke test.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 26 + Next.js 16 (Turbopack, App Router route handlers) |
| Language | TypeScript (strict) |
| ORM | Prisma 7 (`prisma-client` generator, driver adapter) |
| Database | PostgreSQL 18 |
| Auth | JWT (HS256, `sub`/`role`/`email` payload, `iss`/`aud`, expiry) |
| Validation | zod (body + query) |
| Money math | `decimal.js`; persisted money/gold is returned as fixed-point strings |
| Rate limiting | Redis fixed-window tiers with in-memory fallback and response headers |
| Docker | Multi-stage Dockerfile + Docker Compose (PostgreSQL, Redis, migrations, app) |

## Quick start

```bash
# 1. Create local configuration and replace every REPLACE_* value.
cp .env.example .env

# 2. For this candidate demo only, opt in to the simulated funding endpoint:
# ALLOW_SIMULATED_DEPOSITS=true

# 3. Start DB + Redis + migration/seed + app.
docker compose up --build

# 4. Wait for app health, then run the deployment probe.
ADMIN_EMAIL="your-seeded-admin-email" ADMIN_PASSWORD="your-seeded-admin-password" \
  BASE_URL=http://localhost:3000 bash scripts/smoke.sh
```

The Compose stack requires explicit PostgreSQL, JWT, and seed credentials from
`.env`; it does not ship known admin credentials. It starts PostgreSQL and Redis,
runs `prisma migrate deploy` plus the idempotent seed, then serves the Next.js app
on loopback at `http://localhost:3000`.

`ALLOW_SIMULATED_DEPOSITS` defaults to `false` in the production image. Enable it
only for this isolated candidate exercise. A real deployment must credit wallets
from authenticated, idempotent settlement events rather than this endpoint.

Without Docker (local dev):

```bash
npm install
npm run prisma:generate
npx prisma migrate dev        # create + apply migrations
npm run db:seed               # seed admin/user + price
npm run dev                   # http://localhost:3000
```

## API

Base URL: `http://localhost:3000/api`. All protected endpoints require `Authorization: Bearer <token>`. Responses use an envelope:

```jsonc
// success
{ "data": { ... }, "meta": { "pagination": { "page": 1, "pageSize": 20, "total": 12, "totalPages": 1, "hasNext": false, "hasPrevious": false } } }
// error
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid login", "details": [{ "field": "email", "message": "Invalid email" }] } }
```

Money requests accept values of at least `0.01` with at most two decimal places. Gold requests accept at least `0.00000001` gram with at most eight decimal places. Persisted money and gold values in responses are fixed-point strings with two and eight decimal places, respectively. Wallet and trade mutations require a supported `currency`; price administration requires `USD`.

Every API response reports the active window through `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (Unix epoch seconds). A `429` response also includes `Retry-After` in seconds.

### Auth

#### `POST /api/auth/register` — create account (rate limited; duplicate email returns `409`)

```json
// request
{ "name": "Alice", "email": "alice@example.com", "password": "StrongPass123!" }
// 201
{ "data": { "token": "<jwt>", "user": { "id": "<uuid>", "name": "Alice", "email": "alice@example.com", "role": "user", "createdAt": "2026-08-24T10:00:00.000Z" } } }
```

#### `POST /api/auth/login` — exchange credentials for a JWT (rate limited)

```json
// request
{ "email": "alice@example.com", "password": "StrongPass123!" }
// 200
{ "data": { "token": "<jwt>", "user": { "id": "<uuid>", "name": "Alice", "email": "alice@example.com", "role": "user" } } }
```

Invalid login attempts return `401 INVALID_CREDENTIALS` without revealing whether an account exists. A duplicate registration returns `409 CONFLICT`. Deleted (soft-deleted) users cannot log in.

#### `GET /api/auth/me` — current profile + balances + gold holding

```jsonc
// 200
{ "data": {
  "id": "<uuid>", "name": "Alice", "email": "alice@example.com", "role": "user",
  "createdAt": "2026-08-24T10:00:00.000Z",
  "wallets": [ { "currency": "USD", "balance": "950.00" }, { "currency": "EUR", "balance": "0.00" } ],
  "goldHoldings": [ { "grams": "5.00000000" } ],
  "bankBalanceUsd": "950.00", "goldGrams": "5.00000000"
} }
```

### Wallet

#### `POST /api/wallet/deposit` — simulate deposit (rate limited)

```json
// request
{ "amount": 500, "currency": "USD" }
// 201
{ "data": { "walletId": "<uuid>", "balanceAfter": "950.00" } }
```

#### `POST /api/wallet/withdraw` — withdraw (rate limited; balance can never go negative)

```json
// request
{ "amount": 100, "currency": "USD" }
// 200
{ "data": { "walletId": "<uuid>", "previousBalance": "950.00", "balanceAfter": "850.00" } }
// insufficient → 422
{ "error": { "code": "UNPROCESSABLE_ENTITY", "message": "Insufficient USD balance: have 0.00, need 999999999.00" } }
```

#### `GET /api/wallet` — all balances + gold holding

#### `GET /api/wallet/transactions` — own transaction history

Query params: `page`, `pageSize` (max 100), `type` (`deposit|withdraw|trade_buy|trade_sell|adjustment`), `currency`, `from`, `to` (ISO dates).

```http
GET /api/wallet/transactions?page=1&pageSize=20&type=trade_buy&from=2026-08-01
```

### Trading

#### `POST /api/trades/buy` — buy gold with wallet balance (rate limited)

```json
// request
{ "goldAmount": 5, "currency": "USD" }
// 200
{ "data": {
  "tradeId": "<uuid>", "type": "buy", "goldAmount": "5.00000000", "pricePerGram": "125.42",
  "currency": "USD", "totalCost": "627.10", "goldBalanceAfter": "5.00000000", "walletBalanceAfter": "222.90"
} }
// insufficient funds → 422 "Insufficient USD balance: have 0.00, need 627.10"
```

#### `POST /api/trades/sell` — sell gold back to money

```json
// request
{ "goldAmount": 2, "currency": "USD" }
// 200
{ "data": { "tradeId": "<uuid>", "type": "sell", "goldAmount": "2.00000000", "pricePerGram": "125.42", "currency": "USD", "totalCost": "250.84", "goldBalanceAfter": "3.00000000", "walletBalanceAfter": "473.74" } }
// over-selling → 422 "Insufficient gold: have 3.00000000g, need 5.00000000g"
```

Trades use the persisted, admin-controlled USD mock price. Both legs (money + gold) update atomically in one database transaction using conditional updates, so concurrent operations cannot overdraw a wallet or gold holding.

#### `GET /api/trades` — own trade log

Query params: `page`, `pageSize`, `type` (`buy|sell`), `currency`, `from`, `to`.

### Market & broadcast

#### `GET /api/price` — current gold price (public)

```jsonc
// 200
{ "data": { "currency": "USD", "pricePerGram": "125.67", "updatedAt": "2026-08-24T10:00:00.000Z" } }
```

#### `GET /api/broadcasts` — active system broadcasts (auth)

### Admin (role required)

All admin routes return `403 FORBIDDEN` for non-admins, `401` unauthenticated.

#### `GET /api/admin/users` — all users + balances + gold

Query params: `page`, `pageSize`, `q` (name/email search), `role`, `status` (`active|deleted`).

```jsonc
// 200
{ "data": [ { "id": "<uuid>", "name": "Alice", "email": "alice@example.com", "role": "user",
  "deletedAt": null, "createdAt": "...", "bankBalanceUsd": "950.00", "goldGrams": "3.00000000",
  "wallets": [ { "currency": "USD", "balance": "950.00" } ] } ],
  "meta": { "pagination": { "page": 1, "pageSize": 20, "total": 2 } } }
```

#### `POST /api/admin/users` — admin creates a user

```json
// request
{ "name": "Bob", "email": "bob@example.com", "password": "StrongPass123!", "role": "user" }
```

#### `GET /api/admin/users/:id` — single user detail

#### `POST /api/admin/users/:id/adjust` — adjust balance (advanced feature, audited)

```json
// request — amount can be positive (credit) or negative (debit)
{ "amount": 1000, "currency": "USD", "reason": "Compensation for outage" }
// 200
{ "data": { "walletId": "<uuid>", "balanceAfter": "1950.00" } }
```

#### `DELETE /api/admin/users/:id` — soft delete (deactivated users can't log in or transact)

```jsonc
// 200
{ "data": { "id": "<uuid>", "deletedAt": "...", "message": "User deactivated" } }
```

#### `GET /api/admin/transactions` — all transactions, searchable

Query params: `page`, `pageSize`, `type`, `currency`, `from`, `to`, `userName` (fuzzy, case-insensitive).

```http
GET /api/admin/transactions?page=1&pageSize=50&type=withdraw&userName=ali&from=2026-08-01&to=2026-08-24
```

#### `POST /api/admin/broadcasts` — create a system-wide broadcast

```json
// request — expiresAt optional (ISO)
{ "title": "Maintenance", "message": "Scheduled downtime Sunday 02:00 UTC", "expiresAt": "2026-08-28T02:00:00.000Z" }
```

## Implemented platform features

- **Search & filters** — transactions by user name/type/currency/date range; users by name/email/role/status; trades by type/currency/date.
- **Rate limiting** — every route has a general limit of 120 requests per minute; auth routes use 10 per 15 minutes and sensitive wallet/trade mutations use 30 per minute. Successful and error responses expose `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`; `429` also includes `Retry-After`.
- **Pagination** — transaction, trade, and admin-user lists accept `page` + `pageSize` (max 100) and return `meta.pagination` with `total`, `totalPages`, `hasNext`, and `hasPrevious`.
- **Soft delete** — `deletedAt` on users; deleted users cannot log in or use protected routes, while their history is preserved.
- **Security** — bcrypt password hashing, signed JWTs with issuer/audience/expiry validation, database-backed account checks on protected routes, admin RBAC, zod validation, parameterized Prisma/SQL operations, security headers, and no password hashes in responses.
- **Mock price service** — `GET /api/price` is read-only and returns the persisted USD price; admins can replace it with `POST /api/price`. Set `PRICE_WALKER_ENABLED=true` to enable the opt-in background price walker, which varies the configured base price deterministically.
- **Admin broadcasts** — `POST /api/admin/broadcasts` creates one broadcast object; `GET /api/broadcasts` returns active, unexpired broadcasts to authenticated users.
- **Multi-currency settlement** — wallets, deposits, withdrawals, trades, and admin adjustments support `USD`, `EUR`, `LAK`, `THB`, and `CNY`. A single admin-controlled USD price is converted at the static reference rates in `src/services/price.ts`; only the USD reference is persisted or overridden.

## Database design

- Normalized: `User` → `Wallet` (per currency), `Transaction`, `Trade`, `GoldHolding` (1:1), `Adjustment` (audit), `Broadcast`, `Price`.
- Money as `NUMERIC(20,2)`, gold as `NUMERIC(20,8)`.
- Indexes cover user lookup, soft-delete status, transaction/trade chronology and type, broadcast activity, and unique wallet currency per user.
- Atomic conditional updates keep deposits, withdrawals, trades, and adjustments consistent under concurrency; a failed balance check rolls back the surrounding transaction.

```
users ──┬── wallets ── transactions
        ├── gold_holdings
        ├── trades
        ├── adjustments
        └── broadcasts (created_by)
price (singleton row)
```

## Project layout

```
prisma/schema.prisma        schema + indexes
prisma/seed.ts              idempotent seed (admin, demo user, price)
src/lib/                    config, jwt, auth guards, validation, errors, http envelope, rate limit, pagination
src/services/               wallet (locked balance updates), trading (atomic trade), user, price
src/app/api/                route handlers (auth, wallet, trades, admin, broadcasts, price)
scripts/smoke.sh            end-to-end user journey smoke test
Dockerfile / docker-compose.yml
```

## Scaling the rate limiter

With `REDIS_URL`, fixed-window counters use Redis `INCR` plus expiry and are shared by all application instances. If Redis is absent or unavailable, the same general/auth/sensitive tiers fall back to an in-memory window local to each process. Redis is not used as a price cache.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data model, concurrency design,
API conventions, and security decisions.

## Operations

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the HTTPS/HSTS production
profile, health checks, backup verification, destructive restore safeguards,
deployment, rollback, Redis incidents, and secret rotation.

```bash
npm run db:backup
npm run db:verify-backup -- backups/gold-trading-YYYYMMDDTHHMMSSZ.dump
CONFIRM_RESTORE=YES npm run db:restore -- backups/gold-trading-YYYYMMDDTHHMMSSZ.dump
docker compose --profile production up -d --build
```

## OpenAPI spec

The machine-readable contract in [`openapi.yaml`](openapi.yaml) documents all 17 implemented route paths (20 HTTP operations), their request and response envelopes, JWT/admin access requirements, errors, and pagination. Render it with any OpenAPI 3.0 viewer.

## Testing

The suite separates fast pure-unit checks from real API integration tests:

```bash
npm run test:unit         # config, precision schemas, pagination, body limits (83 tests)
npm run test:coverage     # targeted pure-module coverage
npm run test:integration  # 11 API contracts against running PostgreSQL + Redis
npm test                  # all 94 tests when integration services are available
```

Integration tests intentionally use the real database and Redis rather than
mocking financial/concurrency behavior. Test-created users and integration
broadcasts are deleted in `afterAll` when `TEST_CLEANUP_DATABASE_URL` is set.
The smoke script deletes its temporary user on exit. For a disposable test
database, `npm run test:cleanup` removes all `@example.test` users and
integration broadcasts. With the local Compose database, run
`docker compose --profile tools run --rm cleanup` instead.

## Useful commands

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build (standalone)
npx --yes @redocly/cli@1.34.0 lint openapi.yaml
ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run smoke
npm run test:cleanup # cleanup a disposable database
docker compose up --build
```