#!/usr/bin/env bash
set -euo pipefail

target="${1:-auto}"
keep_old="${KEEP_OLD:-true}"
maintenance_mode="${MAINTENANCE_MODE:-0}"
migration_mode="${DEPLOY_MIGRATION_MODE:-}"
skip_migrate="${SKIP_MIGRATE:-0}"
drain_seconds="${DRAIN_SECONDS:-10}"
health_wait_seconds="${HEALTH_WAIT_SECONDS:-300}"
auto_rollback="${AUTO_ROLLBACK:-1}"
compose_file="${COMPOSE_FILE:-docker-compose.bluegreen.yml}"
env_file="${ENV_FILE:-.env.production}"
export PROD_ENV_FILE="$env_file"

state_dir="${DEPLOY_STATE_DIR:-.deploy-state}"
state_file="$state_dir/active-slot"
active="$(cat "$state_file" 2>/dev/null || true)"
has_previous_slot=0
if [[ "$active" == "blue" || "$active" == "green" ]]; then
  has_previous_slot=1
fi

if [[ "$target" == "auto" ]]; then
  case "$active" in
    blue) target="green" ;;
    green) target="blue" ;;
    *) target="blue" ;;
  esac
fi

if [[ "$has_previous_slot" == "1" && "$target" == "$active" ]]; then
  echo "Target slot $target is already active; choose the other slot or use auto."
  exit 2
fi

if [[ "$target" != "blue" && "$target" != "green" ]]; then
  echo "Usage: $0 [blue|green|auto]"
  echo "Optional env: ENV_FILE=.env.production COMPOSE_FILE=docker-compose.bluegreen.yml"
  echo "  MAINTENANCE_MODE=1 先顯示靜態維護頁，再停止舊 API/Web 以節省資源"
  echo "  SKIP_MIGRATE=1      已確認 schema 不變時，可在 MAINTENANCE_MODE=0 無中斷切流"
  echo "  KEEP_OLD=false      blue-green 模式切流後停止舊 slot"
  exit 2
fi

if [[ "$target" == "blue" ]]; then
  old="green"
else
  old="blue"
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")
worker_services=()
target_services=("api-$target" "web-$target")
if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
  worker_services=("celery-worker-$target" celery-beat)
  target_services+=("${worker_services[@]}")
fi

mkdir -p "$state_dir"
exec 9>"$state_dir/deploy.lock"
if ! flock -n 9; then
  echo "A deployment is already running (lock: $state_dir/deploy.lock)"
  exit 1
fi

old_api_container=""
old_web_container=""
old_worker_container=""
old_beat_image=""
if [[ "$has_previous_slot" == "1" ]]; then
  old_api_container="$("${compose[@]}" ps -aq "api-$active")"
  old_web_container="$("${compose[@]}" ps -aq "web-$active")"
  if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
    old_worker_container="$("${compose[@]}" ps -aq "celery-worker-$active")"
    old_beat_container="$("${compose[@]}" ps -q celery-beat)"
    if [[ -n "$old_beat_container" ]]; then
      old_beat_image="$(docker inspect -f '{{.Image}}' "$old_beat_container")"
    fi
  fi
fi

wait_healthy() {
  local service="$1"
  local cid
  cid="$("${compose[@]}" ps -q "$service")"
  if [[ -z "$cid" ]]; then
    echo "Service $service is not running"
    return 1
  fi

  for _ in $(seq 1 "$(( (health_wait_seconds + 1) / 2 ))"); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      echo "$service is $status"
      return 0
    fi
    sleep 2
  done

  echo "$service did not become healthy within ${health_wait_seconds}s"
  docker logs --tail=80 "$cid" || true
  return 1
}

reload_caddy() {
  local config="$1"
  local attempts="${CADDY_RELOAD_ATTEMPTS:-15}"
  local delay_seconds="${CADDY_RELOAD_DELAY_SECONDS:-2}"

  for attempt in $(seq 1 "$attempts"); do
    if "${compose[@]}" exec -T proxy caddy reload --config "/etc/caddy/bluegreen/Caddyfile.$config"; then
      return 0
    fi
    if [[ "$attempt" -lt "$attempts" ]]; then
      echo "Caddy admin API 尚未 ready，${delay_seconds}s 後重試（$attempt/$attempts）" >&2
      sleep "$delay_seconds"
    fi
  done

  return 1
}

enter_maintenance() {
  echo "Entering maintenance mode before stopping the old slot..."
  # 可能已有舊 compose topology 的同名 proxy container；強制重建才能確保
  # Caddy 掛載 blue-green route 與 maintenance page，而不是沿用舊版 mount。
  "${compose[@]}" up -d --force-recreate proxy
  reload_caddy maintenance
  echo "Maintenance page is now active."
}

stop_target_slot() {
  "${compose[@]}" stop "web-$target" "api-$target" || true
  if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
    "${compose[@]}" stop "celery-worker-$target" || true
    "${compose[@]}" stop celery-beat || true
  fi
}

write_active_slot() {
  local slot="$1" tmp_state
  tmp_state="$(mktemp "$state_dir/active-slot.XXXXXX")"
  printf '%s\n' "$slot" > "$tmp_state"
  mv -f "$tmp_state" "$state_file"
}

rollback_to_previous_slot() {
  [[ -n "$old_api_container" && -n "$old_web_container" ]] || return 1

  echo "嘗試恢復舊 active slot：$active"
  docker start "$old_api_container" "$old_web_container" || return 1
  if [[ -n "$old_worker_container" ]]; then
    docker start "$old_worker_container" || return 1
  fi
  if [[ -n "$old_beat_image" ]]; then
    API_IMAGE="$old_beat_image" "${compose[@]}" up -d --no-deps --no-build --pull never celery-beat || return 1
  fi
  wait_healthy "api-$active" || return 1
  wait_healthy "web-$active" || return 1
  reload_caddy "$active" || return 1
  write_active_slot "$active"
  echo "✓ 已將流量恢復到 $active"
  return 0
}

abort_deploy() {
  stop_target_slot
  if [[ "$auto_rollback" == "1" && "$skip_migrate" == "1" ]]; then
    if rollback_to_previous_slot; then
      echo "新版部署失敗，已自動 rollback 到舊 slot。" >&2
      exit 1
    fi
    echo "⚠️  自動 rollback 失敗，改切維護頁。" >&2
  fi
  enter_maintenance || true
  echo "部署失敗，已保持維護頁；請檢查新版容器與 migration。" >&2
  exit 1
}

echo "Target slot: $target (previous slot: $old)"
if [[ "$migration_mode" != "auto" && "$maintenance_mode" != "1" && "$skip_migrate" != "1" ]]; then
  echo "Migrations require MAINTENANCE_MODE=1 so traffic stays on the maintenance page." >&2
  exit 2
fi

echo "Starting shared infrastructure..."
"${compose[@]}" up -d --wait --wait-timeout "$health_wait_seconds" \
  db pgbouncer redis redis-cache redis-broker redis-realtime

if [[ -n "${API_IMAGE:-}" && -n "${WEB_IMAGE:-}" ]]; then
  echo "Pulling immutable target images..."
  "${compose[@]}" pull "${target_services[@]}"
else
  echo "Building target slot: $target..."
  "${compose[@]}" build "${target_services[@]}"
fi

echo "Checking database revision against the target image..."
if ! migration_current="$("${compose[@]}" run -T --rm --no-deps \
  -e 'PGOPTIONS=-c default_transaction_read_only=on' migrate \
  python -m alembic -c /app/alembic.ini current 2>/dev/null)"; then
  echo "Alembic current failed. Check the target image settings and database connection." >&2
  exit 1
fi
schema_at_head=0
if grep -q ' (head)$' <<<"$migration_current"; then
  schema_at_head=1
fi
if [[ "$migration_mode" == "auto" ]]; then
  skip_migrate="$schema_at_head"
  maintenance_mode="$((1 - schema_at_head))"
elif [[ "$skip_migrate" == "1" && "$schema_at_head" != "1" ]]; then
  echo "Database revision is behind the target image. Use maintenance mode with migrations enabled." >&2
  exit 1
fi

bootstrap_compose=("${compose[@]}")
if [[ "$maintenance_mode" == "1" ]]; then
  # 僅在進入維護後為 migration 與新版啟動降低資源用量。
  bootstrap_compose=(
    env
    "GUNICORN_WORKERS=${BOOTSTRAP_GUNICORN_WORKERS:-1}"
    "DB_POOL_SIZE=${BOOTSTRAP_DB_POOL_SIZE:-2}"
    "DB_MAX_OVERFLOW=${BOOTSTRAP_DB_MAX_OVERFLOW:-0}"
    "CELERY_WORKER_CONCURRENCY=${BOOTSTRAP_CELERY_WORKER_CONCURRENCY:-1}"
    "CELERY_DB_POOL_SIZE=${BOOTSTRAP_CELERY_DB_POOL_SIZE:-2}"
    "CELERY_DB_MAX_OVERFLOW=${BOOTSTRAP_CELERY_DB_MAX_OVERFLOW:-0}"
    "${compose[@]}"
  )
  enter_maintenance
  echo "Stopping old API/Web before starting the target slot..."
  "${compose[@]}" stop "web-$old" "api-$old" || true
  if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
    echo "Stopping old worker before starting the target worker..."
    "${compose[@]}" stop "celery-worker-$old" || true
  fi
fi

if [[ "$schema_at_head" == "1" ]]; then
  echo "Schema is already at Alembic head; no migration needed."
else
  echo "Applying migrations in maintenance mode..."
  if ! "${bootstrap_compose[@]}" run -T --rm --no-deps migrate; then
    echo "Migration failed; keeping the maintenance page active." >&2
    exit 1
  fi
fi

echo "Starting target slot: $target..."
if ! "${bootstrap_compose[@]}" up -d --no-deps "${target_services[@]}"; then
  abort_deploy
fi

if ! wait_healthy "api-$target"; then
  abort_deploy
fi
if ! wait_healthy "web-$target"; then
  abort_deploy
fi
if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
  if ! wait_healthy "celery-worker-$target"; then
    abort_deploy
  fi
fi

if [[ "$maintenance_mode" == "1" ]]; then
  echo "Promoting target slot to normal environment resources..."
  if ! "${compose[@]}" up -d --no-deps "${target_services[@]}"; then
    abort_deploy
  fi
  if ! wait_healthy "api-$target" || ! wait_healthy "web-$target"; then
    abort_deploy
  fi
fi

preserve_previous_static_assets() {
  if [[ -z "$old_web_container" ]]; then
    return 0
  fi
  local target_web_container
  target_web_container="$("${compose[@]}" ps -q "web-$target" 2>/dev/null || true)"
  if [[ -z "$target_web_container" ]]; then
    echo "找不到新版 Web 容器，略過舊版 static assets 相容複製。" >&2
    return 0
  fi
  if docker cp "$old_web_container:/app/.next/static/." "$target_web_container:/app/.next/static/"; then
    echo "已保留舊版 Next.js static assets，避免舊頁面 chunk 在切換後 404。"
  else
    echo "無法複製舊版 Next.js static assets；新版頁面仍可部署，但舊頁面可能需要重新整理。" >&2
  fi
}

preserve_previous_static_assets

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  echo "Running smoke test on the target slot..."
  if ! API_SERVICE="api-$target" WEB_SERVICE="web-$target" \
    ENV_FILE="$env_file" COMPOSE_FILE="$compose_file" \
    ./scripts/prod-pull-smoke.sh; then
    echo "Smoke test failed; aborting deploy." >&2
    abort_deploy
  fi
fi

if [[ "$maintenance_mode" != "1" ]]; then
  echo "Starting or reconciling Caddy proxy..."
  "${compose[@]}" up -d --force-recreate proxy
fi

echo "Reloading Caddy to route traffic to $target..."
if ! reload_caddy "$target"; then
  abort_deploy
fi

write_active_slot "$target"

echo "Traffic is now on $target."

if [[ "$maintenance_mode" == "1" ]]; then
  if [[ "$drain_seconds" -gt 0 ]]; then
    echo "Allowing ${drain_seconds}s for old connections to drain..."
    sleep "$drain_seconds"
  fi
  echo "Target slot is active; old slot remains stopped to conserve resources."
  echo "Target healthcheck and smoke test passed before traffic cutover."
elif [[ "$keep_old" == "false" ]]; then
  echo "Stopping old slot: $old..."
  "${compose[@]}" stop "web-$old" "api-$old" "celery-worker-$old" || true
else
  echo "Old slot $old is still running for fast rollback."
  echo "Automatic legacy rollback is disabled after migration."
fi
