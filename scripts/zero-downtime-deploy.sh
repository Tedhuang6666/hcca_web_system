#!/usr/bin/env bash
set -euo pipefail

target="${1:-auto}"
keep_old="${KEEP_OLD:-true}"
maintenance_mode="${MAINTENANCE_MODE:-0}"
drain_seconds="${DRAIN_SECONDS:-10}"
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
  echo "  KEEP_OLD=false      blue-green 模式切流後停止舊 slot"
  exit 2
fi

if [[ "$target" == "blue" ]]; then
  old="green"
else
  old="blue"
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")
bootstrap_compose=("${compose[@]}")
if [[ "$maintenance_mode" == "1" ]]; then
  # 僅套用在新版 bootstrap 與 migration；不寫入 env/compose，也不成為常駐設定。
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
fi
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

wait_healthy() {
  local service="$1"
  local cid
  cid="$("${compose[@]}" ps -q "$service")"
  if [[ -z "$cid" ]]; then
    echo "Service $service is not running"
    return 1
  fi

  for _ in $(seq 1 60); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      echo "$service is $status"
      return 0
    fi
    sleep 2
  done

  echo "$service did not become healthy"
  docker logs --tail=80 "$cid" || true
  return 1
}

run_slot_smoke() {
  local api_service="$1"
  local web_service="$2"
  API_SERVICE="$api_service" WEB_SERVICE="$web_service" \
    ENV_FILE="$env_file" COMPOSE_FILE="$compose_file" \
    ./scripts/prod-pull-smoke.sh
}

check_old_slot_compatibility() {
  if [[ "$has_previous_slot" != "1" ]]; then
    echo "No previous slot recorded; skipping legacy compatibility check."
    return 0
  fi

  local old_api_service="api-$old"
  local old_web_service="web-$old"
  local old_api_id old_web_id
  old_api_id="$("${compose[@]}" ps -aq "$old_api_service")"
  old_web_id="$("${compose[@]}" ps -aq "$old_web_service")"
  if [[ -z "$old_api_id" || -z "$old_web_id" ]]; then
    echo "Previous slot containers are missing; cannot automatically verify schema compatibility." >&2
    return 1
  fi

  echo "Checking the migrated schema against the previous slot..."
  if ! docker start "$old_api_id" >/dev/null; then
    echo "Previous API container could not be started." >&2
    return 1
  fi
  if ! wait_healthy "$old_api_service"; then
    "${compose[@]}" stop "$old_api_service" "$old_web_service" || true
    return 1
  fi
  if ! docker start "$old_web_id" >/dev/null; then
    "${compose[@]}" stop "$old_api_service" || true
    echo "Previous Web container could not be started." >&2
    return 1
  fi
  if ! wait_healthy "$old_web_service"; then
    "${compose[@]}" stop "$old_api_service" "$old_web_service" || true
    return 1
  fi

  if ! run_slot_smoke "$old_api_service" "$old_web_service"; then
    echo "Previous slot failed against the migrated schema." >&2
    "${compose[@]}" stop "$old_api_service" "$old_web_service" || true
    return 1
  fi

  "${compose[@]}" stop "$old_api_service" "$old_web_service"
  echo "Previous slot compatibility check passed; continuing with the new slot."
}

reload_caddy() {
  local config="$1"
  "${compose[@]}" exec -T proxy caddy reload --config "/etc/caddy/bluegreen/Caddyfile.$config"
}

enter_maintenance() {
  echo "Entering maintenance mode before stopping the old slot..."
  "${compose[@]}" up -d proxy
  reload_caddy maintenance
  echo "Maintenance page is now active."
}

stop_target_slot() {
  "${compose[@]}" stop "web-$target" "api-$target" || true
  if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
    "${compose[@]}" stop "celery-worker-$target" || true
  fi
}

abort_deploy() {
  stop_target_slot
  if [[ "$maintenance_mode" != "1" ]]; then
    enter_maintenance || true
  fi
  echo "不會自動啟動舊 slot；前一個 slot 的自動相容性檢查未通過。" >&2
  exit 1
}

echo "Target slot: $target (previous slot: $old)"
echo "Starting shared infrastructure..."
"${compose[@]}" up -d db redis

if [[ -n "${API_IMAGE:-}" && -n "${WEB_IMAGE:-}" ]]; then
  echo "Pulling immutable target images..."
  "${compose[@]}" pull "${target_services[@]}"
else
  echo "Building target slot: $target..."
  "${compose[@]}" build "${target_services[@]}"
fi

if [[ "$maintenance_mode" == "1" ]]; then
  enter_maintenance
  echo "Stopping old API/Web before starting the target slot..."
  "${compose[@]}" stop "web-$old" "api-$old" || true
  if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
    echo "Stopping old worker before starting the target worker..."
    "${compose[@]}" stop "celery-worker-$old" || true
  fi
fi

echo "Applying migrations in maintenance mode..."
if [[ "$maintenance_mode" != "1" ]]; then
  echo "Migrations require MAINTENANCE_MODE=1 so the previous slot can be tested before cutover." >&2
  exit 2
fi
if ! "${bootstrap_compose[@]}" run --rm migrate; then
  echo "Migration failed; keeping the maintenance page active." >&2
  exit 1
fi
if ! check_old_slot_compatibility; then
  echo "Automatic compatibility check failed; keeping the maintenance page active." >&2
  exit 1
fi

echo "Starting target slot: $target..."
if ! "${bootstrap_compose[@]}" up -d "${target_services[@]}"; then
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
  if ! "${compose[@]}" up -d "${target_services[@]}"; then
    abort_deploy
  fi
  if ! wait_healthy "api-$target" || ! wait_healthy "web-$target"; then
    abort_deploy
  fi
fi

echo "Starting or reconciling Caddy proxy..."
"${compose[@]}" up -d proxy

echo "Reloading Caddy to route traffic to $target..."
if ! reload_caddy "$target"; then
  abort_deploy
fi

tmp_state="$(mktemp "$state_dir/active-slot.XXXXXX")"
printf '%s\n' "$target" > "$tmp_state"
mv -f "$tmp_state" "$state_file"

echo "Traffic is now on $target."

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  echo "Running smoke test on the active slot..."
  if ! API_SERVICE="api-$target" WEB_SERVICE="web-$target" \
    ENV_FILE="$env_file" COMPOSE_FILE="$compose_file" \
    ./scripts/prod-pull-smoke.sh; then
    echo "Smoke test failed; switching to maintenance and refusing legacy rollback." >&2
    abort_deploy
  fi
fi

if [[ "$maintenance_mode" == "1" ]]; then
  if [[ "$drain_seconds" -gt 0 ]]; then
    echo "Allowing ${drain_seconds}s for old connections to drain..."
    sleep "$drain_seconds"
  fi
  echo "Target slot is active; old slot remains stopped to conserve resources."
  echo "Previous slot was automatically checked before traffic cutover."
elif [[ "$keep_old" == "false" ]]; then
  echo "Stopping old slot: $old..."
  "${compose[@]}" stop "web-$old" "api-$old" "celery-worker-$old" || true
else
  echo "Old slot $old is still running for fast rollback."
  echo "Automatic legacy rollback is disabled after migration."
fi
