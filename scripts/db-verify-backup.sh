#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 backups/<file>.dump" >&2
  exit 2
fi

backup_path="$1"
if [[ ! -s "$backup_path" ]]; then
  echo "Backup does not exist or is empty: $backup_path" >&2
  exit 2
fi
if [[ -f "${backup_path}.sha256" ]]; then
  sha256sum --check "${backup_path}.sha256"
fi

# Verify archive structure before touching PostgreSQL.
docker compose exec -T db pg_restore --list < "$backup_path" > /dev/null

verify_db="restore_verify_$(date -u +%Y%m%d%H%M%S)_$$"
cleanup() {
  docker compose exec -T db sh -c 'dropdb --username="$POSTGRES_USER" --if-exists "$1"' _ "$verify_db" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose exec -T db sh -c 'createdb --username="$POSTGRES_USER" "$1"' _ "$verify_db"
docker compose exec -T db sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$1" --exit-on-error --no-owner --no-acl' _ "$verify_db" < "$backup_path"

migration_count="$(docker compose exec -T db sh -c 'psql --username="$POSTGRES_USER" --dbname="$1" --tuples-only --no-align --command="SELECT count(*) FROM \"_prisma_migrations\";"' _ "$verify_db")"
user_count="$(docker compose exec -T db sh -c 'psql --username="$POSTGRES_USER" --dbname="$1" --tuples-only --no-align --command="SELECT count(*) FROM \"User\";"' _ "$verify_db")"

printf 'Backup verified in isolated DB %s (migrations=%s, users=%s)\n' "$verify_db" "$migration_count" "$user_count"
