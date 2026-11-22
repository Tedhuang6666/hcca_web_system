#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="hcca-test"
COMPOSE_FILE="$ROOT/docker-compose.test.yml"
SERVICES=(db redis)
COMPOSE=(docker compose --project-name "$PROJECT" --file "$COMPOSE_FILE")

usage() {
  printf '%s\n' \
    '用法：bash scripts/check.sh test-services <up|ensure|check|status|down>' \
    'up/ensure：啟動隔離的 PostgreSQL 與 Redis 測試服務並等待健康檢查' \
    'check：確認測試容器已健康' \
    'status：顯示測試容器狀態' \
    'down：停止測試容器，保留 PostgreSQL 測試資料卷'
}

require_engine() {
  if ! command -v docker >/dev/null 2>&1; then
    printf '%s\n' '找不到 Docker CLI。請安裝 Docker Desktop 並啟用此 WSL 發行版整合。' >&2
    exit 1
  fi
  if ! timeout 5s docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
    printf '%s\n' \
      'Docker Engine 無法連線。請啟動 Docker Desktop，並在 Settings > Resources > WSL Integration 啟用目前的 WSL 發行版。' >&2
    exit 1
  fi
}

wait_for_health() {
  local wait=${1:-true}
  local deadline=$((SECONDS + 60))
  local all_healthy container_id state health service

  while (( SECONDS < deadline )); do
    all_healthy=true
    for service in "${SERVICES[@]}"; do
      container_id="$("${COMPOSE[@]}" ps --quiet "$service" 2>/dev/null || true)"
      if [[ -z "$container_id" ]]; then
        if [[ "$wait" == false ]]; then
          printf '測試服務 %s 尚未建立。執行 `bash scripts/check.sh test-services up`。\n' \
            "$service" >&2
          exit 1
        fi
        all_healthy=false
        continue
      fi
      state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
      health="$(
        docker inspect \
          --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
          "$container_id" 2>/dev/null || true
      )"
      if [[ "$state" == exited || "$state" == dead || "$health" == unhealthy ]]; then
        printf '測試服務 %s 啟動失敗（state=%s, health=%s）。\n' \
          "$service" "${state:-unknown}" "${health:-unknown}" >&2
        exit 1
      fi
      if [[ "$state" != running || "$health" != healthy ]]; then
        if [[ "$wait" == false ]]; then
          printf '測試服務 %s 尚未健康（state=%s, health=%s）。\n' \
            "$service" "${state:-unknown}" "${health:-unknown}" >&2
          exit 1
        fi
        all_healthy=false
      fi
    done

    if [[ "$all_healthy" == true ]]; then
      printf '%s\n' '測試 PostgreSQL 與 Redis 已就緒。'
      return
    fi
    sleep 1
  done

  printf '%s\n' '測試服務 60 秒內未就緒；執行 `bash scripts/check.sh test-services status` 查看狀態。' >&2
  exit 1
}

mode="${1:-help}"
cd "$ROOT"

case "$mode" in
  up|ensure)
    require_engine
    "${COMPOSE[@]}" config --quiet
    timeout 180s "${COMPOSE[@]}" up -d
    wait_for_health
    TEST_DATABASE_URL='postgresql+asyncpg://hcca_test:hcca_test@127.0.0.1:55432/campus_platform_test' \
      TEST_REDIS_URL='redis://127.0.0.1:56379/5' \
      python3 "$ROOT/scripts/check-test-dependencies.py"
    ;;
  check)
    require_engine
    wait_for_health false
    TEST_DATABASE_URL='postgresql+asyncpg://hcca_test:hcca_test@127.0.0.1:55432/campus_platform_test' \
      TEST_REDIS_URL='redis://127.0.0.1:56379/5' \
      python3 "$ROOT/scripts/check-test-dependencies.py"
    ;;
  status)
    require_engine
    "${COMPOSE[@]}" ps
    ;;
  down)
    require_engine
    "${COMPOSE[@]}" down
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
