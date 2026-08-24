# Architecture — Gold Trading System

One-page overview: stack, data model, key design decisions, and security posture.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node 26, Next.js 16 (App Router route handlers — REST endpoints under `/api`) |
| Language | TypeScript (strict) |
| ORM | Prisma 7 (`prisma` driver adapter on `pg`, query-compiler client) |
| Database | PostgreSQL 18 |
| Auth | Stateless JWT (HS256, `sub`/`role`/`email`, `iss`/`aud`, expiry) |
| Validation | zod (bodies + query params) |
| Money math | `decimal.js`; persisted money/gold leaves the API as fixed-point strings |
| Rate limiting | Redis fixed-window tiers, in-memory fallback, and limit/reset response headers |
| Ops | Docker Compose (PostgreSQL + Redis → migrate/seed → app), multi-stage Dockerfile |

## Data model

```
User ── 1:N ── Wallet (unique per user+currency) ── 1:N ── Transaction
  │ 1:1 ── GoldHolding (grams)
  │ 1:N ── Trade (buy/sell, price_per_gram, total_cost)
  │ 1:N ── Adjustment (admin balance-override audit trail)
  │ 1:N ── Broadcast (system-wide messages, created by admins)
Price (singleton row — admin-controlled mock USD price)
```

- `Decimal(20,2)` for money and prices; `Decimal(20,8)` for gold grams. API responses serialize those persisted values as fixed-point strings.
- Indexes cover user lookup, soft-delete status, transaction/trade chronology and type, broadcast activity, and unique `(userId, currency)` wallets.

## Concurrency invariant: balances cannot go negative

Money and gold mutations run inside `prisma.$transaction` and use conditional
database updates:

1. Apply the requested delta only when the resulting wallet or gold balance is non-negative.
2. Read the updated value returned by that statement.
3. Write the related `Transaction`, `Trade`, or `Adjustment` record in the same transaction.
4. Reject and roll back when the conditional update finds insufficient funds or gold.

This makes the balance check and update one database operation. Concurrent
withdrawals or sales cannot both spend the same balance, and a crash rolls back
both sides of a trade.

Detected PostgreSQL serialization failures or deadlocks are retried up to three
times with bounded exponential backoff. An exhausted conflict returns
`409 CONCURRENT_UPDATE_CONFLICT`, allowing clients to retry safely.

## API design

| Area | Routes |
|------|--------|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` |
| Wallet | `POST /api/wallet/deposit` · `POST /api/wallet/withdraw` · `GET /api/wallet` · `GET /api/wallet/transactions` |
| Trading | `POST /api/trades/buy` · `POST /api/trades/sell` · `GET /api/trades` |
| Market | `GET /api/price` (public) · `POST /api/price` (admin; USD only) |
| Broadcasts | `GET /api/broadcasts` (authenticated) · `POST /api/admin/broadcasts` (admin; one object) |
| Admin | `GET/POST /api/admin/users` · `GET/DELETE /api/admin/users/[id]` · `POST /api/admin/users/[id]/adjust` · `GET /api/admin/transactions` |

Conventions: `{ data }` / `{ error }` envelopes, `meta.pagination` on paginated
lists, UUIDs via Prisma, fixed-point string outputs for persisted decimals, and
`Authorization: Bearer <jwt>`. Registration, login, and price reads are public;
all other reads/mutations require a valid token, and admin routes also require
the `admin` role. Duplicate registration returns `409`.

## Security decisions

- **RBAC**: every protected request re-loads the user from the DB — role changes and soft
  deletes take effect immediately (a stateless JWT alone would stay valid after
  deactivation). Admin routes call `requireAdmin` → 403.
- **Soft delete**: `deletedAt` on users; deleted users get 401 on login *and* on
  every protected action.
- **Input validation**: zod validates request bodies and supported query
  parameters; database operations use parameterized Prisma or tagged SQL.
  JSON responses use restrictive API security headers.
- **Passwords**: bcrypt (10 rounds). JWT secret from env, fail-fast if missing.
- **Rate limits**: every route has a 120-request/minute general window;
  registration/login use 10 requests per 15 minutes, and sensitive
  deposit/withdraw/buy/sell mutations use 30 per minute. Counters are
  cluster-wide through Redis when `REDIS_URL` is available and fall back to a
  per-process fixed window if Redis is unavailable. Every response includes
  `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`; `429`
  responses also include `Retry-After`.

## Deliberate scope

- Wallets and gold settlement support `USD`, `EUR`, `LAK`, `THB`, and `CNY`.
  The persisted source price and admin override are USD-only; trade settlement
  converts that reference with the static rates in `src/services/price.ts`.
- The singleton price is changed only by an administrator; there is no
  background walker and no Redis price cache.
- Simulated deposits are behind `ALLOW_SIMULATED_DEPOSITS`; production defaults
  to disabled. Real funding requires authenticated idempotent settlement events.
- Redis is used for configured rate-limit counters only. Read and write Prisma
  clients use separate pools.
- Production TLS/HSTS belongs at the proxy layer, not in the API image.
- The application image runs as the non-root `node` user. Compose applies
  `no-new-privileges`, drops Linux capabilities, uses a read-only root filesystem
  with `/tmp` tmpfs, and gates traffic on the application health check.

## Run it

```bash
docker compose up --build          # PostgreSQL + Redis + migrate/seed + app on :3000
BASE_URL=http://localhost:3000 bash scripts/smoke.sh   # end-to-end journey
npm run typecheck && npm run build # static checks
```
