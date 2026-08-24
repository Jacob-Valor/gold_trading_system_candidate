#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: CONFIRM_RESTORE=YES $0 backups/<file>.dump" >&2
  exit 2
fi

backup_path="$1"
if [[ ! -s "$backup_path" ]]; then
  echo "Backup does not exist or is empty: $backup_path" >&2
  exit 2
fi
if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Refusing destructive restore. Set CONFIRM_RESTORE=YES." >&2
  exit 2
fi
if [[ -f "${backup_path}.sha256" ]]; then
  sha256sum --check "${backup_path}.sha256"
fi

edge_was_running=false
if docker compose --profile production ps --services --status running | grep -qx edge; then
  edge_was_running=true
fi

echo "Stopping application and TLS edge..."
docker compose stop app >/dev/null
if [[ "$edge_was_running" == "true" ]]; then
  docker compose --profile production stop edge >/dev/null
fi

echo "Restoring database from $backup_path..."
if ! docker compose exec -T db sh -eu -c '
  pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --clean \
    --if-exists \
    --exit-on-error \
    --no-owner \
    --no-acl
' < "$backup_path"; then
  echo "Restore failed. Application remains stopped for investigation." >&2
  exit 1
fi

echo "Applying forward-compatible migrations..."
docker compose run --rm --no-deps migrate sh -c 'npx prisma migrate deploy'

echo "Starting application..."
docker compose start app >/dev/null
if [[ "$edge_was_running" == "true" ]]; then
  docker compose --profile production start edge >/dev/null
fi
printf 'Restore complete: %s\n' "$backup_path"
