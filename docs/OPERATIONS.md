# Operations Runbook

Production-oriented procedures for TLS, deployment, backup, restore, rollback,
Redis incidents, and secret rotation. Commands assume repository root and Docker
Compose v2.

## Production prerequisites

1. Create `.env` from `.env.example`; replace every `REPLACE_*` value.
2. Set `DOMAIN` to a DNS name whose A/AAAA record points at the host.
3. Set `TRUST_PROXY=true` only when public traffic reaches the app through Caddy.
4. Keep `ALLOW_SIMULATED_DEPOSITS=false`. Production credits must come from an
   authenticated, idempotent settlement integration.
5. Permit inbound TCP 80/443 and UDP 443. Do not publish PostgreSQL or Redis.
6. Store `.env` in a secret manager or root-readable host file, never Git.

## Start with HTTPS and HSTS

```bash
docker compose --profile production up -d --build
docker compose --profile production ps
curl --fail --silent --show-error --head "https://${DOMAIN}/api/price"
```

Caddy obtains and renews a public certificate automatically for real DNS names.
For `DOMAIN=localhost`, Caddy uses its local CA; test with `curl --cacert` using the
exported local CA, or `curl -k` only for a local smoke check.

Expected headers include:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

## Health and readiness

```bash
docker compose --profile production ps
docker compose logs --since=10m app
docker compose logs --since=10m edge
curl --fail --silent http://127.0.0.1:${PORT:-3000}/api/price
```

The app starts only after PostgreSQL, Redis, and migrations are healthy/complete;
the edge starts only after the app health check succeeds.

## Backup

Create a consistent PostgreSQL custom-format archive plus SHA-256 checksum:

```bash
npm run db:backup
```

Optional retention policy:

```bash
BACKUP_RETENTION_DAYS=14 npm run db:backup
```

Copy the `.dump` and `.sha256` files to encrypted off-site/object storage. Local
`backups/` is ignored by Git and is not a disaster-recovery location.

### Suggested objectives

- RPO: 24 hours with daily backup; lower it by scheduling more frequently.
- RTO: 60 minutes after host/database replacement.
- Keep at least one monthly restore-verified archive.

## Verify a backup without touching production data

```bash
npm run db:verify-backup -- backups/gold-trading-YYYYMMDDTHHMMSSZ.dump
```

This validates the checksum and archive, restores into a temporary database,
queries Prisma migration/user tables, then drops the temporary database.
A backup is not accepted until this command succeeds.

## Restore

Restore is destructive and stops the application first:

```bash
CONFIRM_RESTORE=YES npm run db:restore -- backups/gold-trading-YYYYMMDDTHHMMSSZ.dump
```

The script verifies the checksum, stops app/edge, restores with `--clean`, applies
forward-compatible Prisma migrations, then starts the app. On restore failure the
app remains stopped for investigation.

Post-restore checks:

```bash
docker compose ps
npm test
BASE_URL=http://127.0.0.1:${PORT:-3000} npm run smoke
```

## Deployment

1. Verify CI is green: integration tests, typecheck, build.
2. Create a database backup and verify it.
3. Record current image digest and Git revision.
4. Pull/build the target revision.
5. Run migrations before replacing the app.
6. Recreate app, then verify health, authentication, wallet read, and price read.

```bash
previous_image="$(docker inspect gold-trading-system-app-1 --format '{{.Image}}')"
printf 'Previous image: %s\n' "$previous_image"

npm run db:backup
docker compose build app migrate
docker compose run --rm migrate sh -c 'npx prisma migrate deploy'
docker compose up -d --no-deps app
docker compose ps
npm run smoke
```

## Application rollback

Use immutable image tags/digests in an external production override. If the new
app fails but the migration is backward-compatible, restore the prior image and
recreate only the app:

```bash
# Re-point the Compose image tag at the previously recorded immutable image id.
docker tag \"${previous_image}\" gold-trading-system-app:latest
docker compose up -d --no-build --force-recreate --no-deps app
docker compose ps
npm run smoke
```

Registry deployments should use immutable image digests in their platform
manifest and change the digest back to the recorded previous value.

## Database rollback policy

Prisma migrations are forward-only. Do **not** edit an applied migration or run
ad-hoc destructive SQL during an incident.

- Backward-compatible migration + bad app: roll back the app image only.
- Bad schema migration with no committed data: deploy a corrective migration.
- Destructive/incompatible migration: stop writes and restore the verified
  pre-deploy backup, then run the previous app image.

Document the incident time, backup used, restored checksum, migration state, and
validation results.

## Redis incident

Redis holds rate-limit counters only; PostgreSQL remains the source of truth.
If Redis is unavailable the app falls back to per-process limits.

```bash
docker compose logs --since=10m redis
docker compose restart redis
docker compose exec redis redis-cli ping
```

During multi-instance Redis outage, apply temporary edge-level limits because
per-process fallback is not globally coordinated.

## Secret rotation

- JWT secret: rotate during a maintenance window; all existing tokens become
  invalid immediately.
- PostgreSQL password: update the database role and deployment secret together,
  then recreate migrate/app services.
- Seed credentials: bootstrap only; disable/delete predictable seeded accounts
  before production launch.
- After any suspected exposure, rotate secrets first, then inspect admin balance
  adjustments, account deletions, broadcasts, and price changes.
