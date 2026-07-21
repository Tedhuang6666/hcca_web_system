#!/usr/bin/env bash
set -euo pipefail

target="${1:-auto}"
keep_old="${KEEP_OLD:-true}"
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
  echo "Optional env: ENV_FILE=.env.production COMPOSE_FILE=docker-compose.bluegreen.yml KEEP_OLD=false"
  exit 2
fi

if [[ "$target" == "blue" ]]; then
  old="green"
else
  old="blue"
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")
worker_services=()
if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
  worker_services=("celery-worker-$target" celery-beat)
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

echo "Target slot: $target (previous slot: $old)"
echo "Starting shared infrastructure..."
"${compose[@]}" up -d db redis

if [[ -n "${API_IMAGE:-}" && -n "${WEB_IMAGE:-}" ]]; then
  echo "Pulling immutable target images..."
  "${compose[@]}" pull "api-$target" "web-$target" "celery-worker-$target"
else
  echo "Building target slot: $target..."
  "${compose[@]}" build "api-$target" "web-$target" "celery-worker-$target"
fi

echo "Applying backward-compatible migrations..."
"${compose[@]}" run --rm migrate

echo "Starting target slot: $target..."
"${compose[@]}" up -d "api-$target" "web-$target" "${worker_services[@]}"

wait_healthy "api-$target"
wait_healthy "web-$target"
if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
  wait_healthy "celery-worker-$target"
fi

echo "Starting or reconciling Caddy proxy..."
"${compose[@]}" up -d proxy

echo "Reloading Caddy to route traffic to $target..."
"${compose[@]}" exec -T proxy caddy reload --config "/etc/caddy/bluegreen/Caddyfile.$target"

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
      if "${compose[@]}" exec -T proxy caddy reload --config "/etc/caddy/bluegreen/Caddyfile.$old"; then
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

if [[ "$keep_old" == "false" ]]; then
  echo "Stopping old slot: $old..."
  "${compose[@]}" stop "web-$old" "api-$old" "celery-worker-$old" || true
else
  echo "Old slot $old is still running for fast rollback."
  echo "Rollback command: bash scripts/zero-downtime-deploy.sh $old"
fi
