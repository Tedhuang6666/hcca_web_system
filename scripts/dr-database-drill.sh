#!/usr/bin/env bash
set -euo pipefail

source_db="${SOURCE_DB:-hcca_optimization_test}"
target_db="${TARGET_DB:-hcca_optimization_restore_drill}"
db_container="${DB_CONTAINER:-campus_db}"
db_user="${DB_USER:-postgres}"
db_password="${DB_PASSWORD:-postgres}"
report_dir="${REPORT_DIR:-artifacts}"

if [[ "$target_db" != *_drill ]]; then
  echo "TARGET_DB must end with _drill: $target_db" >&2
  exit 2
fi
if [[ "$source_db" == "$target_db" ]]; then
  echo "SOURCE_DB and TARGET_DB must differ" >&2
  exit 2
fi

mkdir -p "$report_dir"
dump_file="$(mktemp --suffix=.dump)"
trap 'rm -f "$dump_file"' EXIT

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date +%s)"

docker exec "$db_container" pg_dump \
  -U "$db_user" \
  -d "$source_db" \
  --format=custom \
  --no-owner \
  --no-acl >"$dump_file"

docker exec "$db_container" dropdb -U "$db_user" --if-exists "$target_db"
docker exec "$db_container" createdb -U "$db_user" "$target_db"
docker exec -i "$db_container" pg_restore \
  -U "$db_user" \
  -d "$target_db" \
  --no-owner \
  --no-acl <"$dump_file"

source_tables="$(
  docker exec "$db_container" psql -U "$db_user" -d "$source_db" -tAc \
    "select count(*) from pg_tables where schemaname = 'public'"
)"
target_tables="$(
  docker exec "$db_container" psql -U "$db_user" -d "$target_db" -tAc \
    "select count(*) from pg_tables where schemaname = 'public'"
)"
source_revision="$(
  docker exec "$db_container" psql -U "$db_user" -d "$source_db" -tAc \
    "select version_num from alembic_version"
)"
target_revision="$(
  docker exec "$db_container" psql -U "$db_user" -d "$target_db" -tAc \
    "select version_num from alembic_version"
)"

if [[ "$source_tables" != "$target_tables" || "$source_revision" != "$target_revision" ]]; then
  echo "Restore verification failed" >&2
  exit 1
fi

database_url="postgresql+asyncpg://${db_user}:${db_password}@localhost:5432/${target_db}"
database_url_sync="postgresql+psycopg2://${db_user}:${db_password}@localhost:5432/${target_db}"
DATABASE_URL="$database_url" DATABASE_URL_SYNC="$database_url_sync" \
  uv run --project apps/api alembic downgrade -1
DATABASE_URL="$database_url" DATABASE_URL_SYNC="$database_url_sync" \
  uv run --project apps/api alembic upgrade head

final_revision="$(
  docker exec "$db_container" psql -U "$db_user" -d "$target_db" -tAc \
    "select version_num from alembic_version"
)"
if [[ "$final_revision" != "$source_revision" ]]; then
  echo "Migration rollback drill did not return to head" >&2
  exit 1
fi

finished_epoch="$(date +%s)"
rto_seconds="$((finished_epoch - started_epoch))"
report="$report_dir/dr-database-$(date -u +%Y%m%dT%H%M%SZ).md"

cat >"$report" <<EOF
# Database DR Drill

- Started: $started_at
- Source database: $source_db
- Restored database: $target_db
- Public tables verified: $target_tables
- Alembic head verified: $final_revision
- Migration rollback: downgrade one revision, then upgrade head
- Restore RTO: ${rto_seconds} seconds
- Backup snapshot RPO: 0 seconds for this on-demand drill
- Result: PASS
EOF

echo "DR drill passed; report: $report"
