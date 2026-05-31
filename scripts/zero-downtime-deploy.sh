#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
keep_old="${KEEP_OLD:-true}"
compose_file="${COMPOSE_FILE:-docker-compose.bluegreen.yml}"
env_file="${ENV_FILE:-.env.production}"
export PROD_ENV_FILE="$env_file"

if [[ "$target" != "blue" && "$target" != "green" ]]; then
  echo "Usage: $0 blue|green"
  echo "Optional env: ENV_FILE=.env.production COMPOSE_FILE=docker-compose.bluegreen.yml KEEP_OLD=false"
  exit 2
fi

if [[ "$target" == "blue" ]]; then
  old="green"
else
  old="blue"
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")

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

echo "Starting shared infrastructure..."
"${compose[@]}" up -d db redis proxy

echo "Building target slot: $target..."
"${compose[@]}" build "api-$target" "web-$target" "celery-worker-$target"

echo "Applying backward-compatible migrations..."
"${compose[@]}" run --rm migrate

echo "Starting target slot: $target..."
"${compose[@]}" up -d "api-$target" "web-$target" "celery-worker-$target" celery-beat

wait_healthy "api-$target"
wait_healthy "web-$target"
wait_healthy "celery-worker-$target"

echo "Reloading Caddy to route traffic to $target..."
"${compose[@]}" exec -T proxy caddy reload --config "/etc/caddy/bluegreen/Caddyfile.$target"

echo "Traffic is now on $target."

if [[ "$keep_old" == "false" ]]; then
  echo "Stopping old slot: $old..."
  "${compose[@]}" stop "web-$old" "api-$old" "celery-worker-$old" || true
else
  echo "Old slot $old is still running for fast rollback."
  echo "Rollback command: bash scripts/zero-downtime-deploy.sh $old"
fi
