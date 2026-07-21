#!/usr/bin/env bash
set -euo pipefail

target="${1:-auto}"
keep_old="${KEEP_OLD:-true}"
maintenance_mode="${MAINTENANCE_MODE:-0}"
drain_seconds="${DRAIN_SECONDS:-10}"
compose_file="${COMPOSE_FILE:-docker-compose.bluegreen.yml}"
env_file="${ENV_FILE:-.env.production}"
export PROD_ENV_FILE="$env_file"

# 維護模式只保留一個 API slot，預設採用較小的啟動資源，避免新版啟動時再次
# 以 4 workers + pool 10/20 把低規格主機推入 OOM。正式環境仍可用環境變數覆寫。
if [[ "$maintenance_mode" == "1" ]]; then
  export GUNICORN_WORKERS="${GUNICORN_WORKERS:-1}"
  export DB_POOL_SIZE="${DB_POOL_SIZE:-2}"
  export DB_MAX_OVERFLOW="${DB_MAX_OVERFLOW:-0}"
  export CELERY_WORKER_CONCURRENCY="${CELERY_WORKER_CONCURRENCY:-1}"
  export CELERY_DB_POOL_SIZE="${CELERY_DB_POOL_SIZE:-2}"
  export CELERY_DB_MAX_OVERFLOW="${CELERY_DB_MAX_OVERFLOW:-0}"
fi

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

restore_old_slot() {
  if [[ "$has_previous_slot" != "1" ]]; then
    echo "No previous slot is available for rollback." >&2
    return 1
  fi

  echo "Attempting to restore old slot: $old..." >&2
  if [[ "$maintenance_mode" == "1" ]]; then
    "${compose[@]}" stop "web-$target" "api-$target" || true
    if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
      "${compose[@]}" stop "celery-worker-$target" || true
    fi
  fi
  "${compose[@]}" up -d "api-$old" "web-$old"
  if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
    "${compose[@]}" up -d "celery-worker-$old"
  fi
  wait_healthy "api-$old" || return 1
  wait_healthy "web-$old" || return 1
  reload_caddy "$old"
  tmp_state="$(mktemp "$state_dir/active-slot.XXXXXX")"
  printf '%s\n' "$old" > "$tmp_state"
  mv -f "$tmp_state" "$state_file"
  echo "Traffic restored to $old." >&2
}

abort_maintenance_deploy() {
  echo "Target slot failed; keeping the maintenance page active." >&2
  "${compose[@]}" stop "web-$target" "api-$target" || true
  if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
    "${compose[@]}" stop "celery-worker-$target" || true
  fi
  restore_old_slot || true
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

echo "Applying backward-compatible migrations..."
if ! "${compose[@]}" run --rm migrate; then
  echo "Migration failed; keeping the maintenance page active." >&2
  if [[ "$maintenance_mode" == "1" ]]; then
    restore_old_slot || true
  fi
  exit 1
fi

echo "Starting target slot: $target..."
if ! "${compose[@]}" up -d "${target_services[@]}"; then
  if [[ "$maintenance_mode" == "1" ]]; then
    abort_maintenance_deploy
  fi
  exit 1
fi

if ! wait_healthy "api-$target"; then
  if [[ "$maintenance_mode" == "1" ]]; then
    abort_maintenance_deploy
  fi
  exit 1
fi
if ! wait_healthy "web-$target"; then
  if [[ "$maintenance_mode" == "1" ]]; then
    abort_maintenance_deploy
  fi
  exit 1
fi
if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
  if ! wait_healthy "celery-worker-$target"; then
    if [[ "$maintenance_mode" == "1" ]]; then
      abort_maintenance_deploy
    fi
    exit 1
  fi
fi

echo "Starting or reconciling Caddy proxy..."
"${compose[@]}" up -d proxy

echo "Reloading Caddy to route traffic to $target..."
reload_caddy "$target"

tmp_state="$(mktemp "$state_dir/active-slot.XXXXXX")"
printf '%s\n' "$target" > "$tmp_state"
mv -f "$tmp_state" "$state_file"

echo "Traffic is now on $target."

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  echo "Running smoke test on the active slot..."
  if ! API_SERVICE="api-$target" WEB_SERVICE="web-$target" \
    ENV_FILE="$env_file" COMPOSE_FILE="$compose_file" \
    ./scripts/prod-pull-smoke.sh; then
    if [[ "$has_previous_slot" == "1" ]]; then
      echo "Smoke test failed; rolling traffic back to $old..." >&2
      if [[ "$maintenance_mode" == "1" ]]; then
        restore_old_slot || true
      elif reload_caddy "$old"; then
        tmp_state="$(mktemp "$state_dir/active-slot.XXXXXX")"
        printf '%s\n' "$old" > "$tmp_state"
        mv -f "$tmp_state" "$state_file"
      else
        echo "Rollback failed; inspect the proxy and both slots manually." >&2
      fi
    else
      echo "Smoke test failed; no previous active slot is recorded, so automatic rollback is unavailable." >&2
      rm -f "$state_file"
    fi
    exit 1
  fi
fi

if [[ "$maintenance_mode" == "1" ]]; then
  if [[ "$drain_seconds" -gt 0 ]]; then
    echo "Allowing ${drain_seconds}s for old connections to drain..."
    sleep "$drain_seconds"
  fi
  echo "Target slot is active; old slot remains stopped to conserve resources."
  echo "Rollback command: MAINTENANCE_MODE=1 bash scripts/zero-downtime-deploy.sh $old"
elif [[ "$keep_old" == "false" ]]; then
  echo "Stopping old slot: $old..."
  "${compose[@]}" stop "web-$old" "api-$old" "celery-worker-$old" || true
else
  echo "Old slot $old is still running for fast rollback."
  echo "Rollback command: bash scripts/zero-downtime-deploy.sh $old"
fi
