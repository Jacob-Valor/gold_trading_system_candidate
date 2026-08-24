#!/usr/bin/env bash
set -euo pipefail

umask 077
backup_dir="${BACKUP_DIR:-backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_path="${backup_dir}/gold-trading-${timestamp}.dump"
tmp_path="${final_path}.tmp"

mkdir -p "$backup_dir"
trap 'rm -f "$tmp_path"' EXIT

docker compose exec -T db sh -eu -c '
  pg_dump \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-acl
' > "$tmp_path"

test -s "$tmp_path"
mv "$tmp_path" "$final_path"
sha256sum "$final_path" > "${final_path}.sha256"

if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  find "$backup_dir" -type f -name 'gold-trading-*.dump*' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
fi

printf 'Backup: %s\nChecksum: %s.sha256\n' "$final_path" "$final_path"
