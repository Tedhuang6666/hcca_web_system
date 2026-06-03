#!/usr/bin/env bash
# 一鍵拉取 + 部署（GHCR 預建映像版）。在 VPS 的 repo 目錄執行：
#   ./scripts/prod-pull-deploy.sh
#
# 流程：git pull → compose pull → 起穩定核心 → 起 email-worker → ps → smoke test。
# 預設「不」啟動 celery-worker / celery-beat（重背景任務）；要一起開：
#   WITH_WORKERS=1 ./scripts/prod-pull-deploy.sh
#
# 可用環境變數覆寫：
#   ENV_FILE=.env.production COMPOSE_FILE=docker-compose.prod.pull.yml
#   WITH_WORKERS=1     # 連 celery-worker / celery-beat 一起起
#   SKIP_GIT=1         # 跳過 git pull（例如手動同步檔案時）
set -euo pipefail
cd "$(dirname "$0")/.."

env_file="${ENV_FILE:-.env.production}"
compose_file="${COMPOSE_FILE:-docker-compose.prod.pull.yml}"
export PROD_ENV_FILE="$env_file"
compose=(docker compose --env-file "$env_file" -f "$compose_file")

# 穩定核心 + 寄信 worker（email-worker 在 email profile，需明確帶入）
profiles=(--profile email)
if [[ "${WITH_WORKERS:-0}" == "1" ]]; then
  profiles+=(--profile workers)
fi

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

if [[ "${SKIP_GIT:-0}" != "1" && -d .git ]]; then
  step "git pull"
  git pull --ff-only
fi

step "docker compose pull（拉最新映像）"
"${compose[@]}" "${profiles[@]}" pull

step "啟動服務（--remove-orphans 清掉已退出 profile 的孤兒容器）"
"${compose[@]}" "${profiles[@]}" up -d --remove-orphans

step "目前服務狀態"
"${compose[@]}" ps

step "等待 healthcheck 收斂（最多 90s）"
deadline=$(( $(date +%s) + 90 ))
while :; do
  unhealthy="$("${compose[@]}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null \
    | awk '$2=="unhealthy" || $2=="starting" {print $1}')"
  if [[ -z "$unhealthy" ]]; then
    echo "所有有 healthcheck 的服務皆 healthy"
    break
  fi
  if [[ "$(date +%s)" -ge "$deadline" ]]; then
    echo "逾時，下列服務尚未 healthy：$unhealthy"
    break
  fi
  sleep 5
done

step "部署後 smoke test"
ENV_FILE="$env_file" COMPOSE_FILE="$compose_file" ./scripts/prod-pull-smoke.sh
