#!/usr/bin/env bash
# 部署後 smoke test：快速確認核心服務真的活著（不只是容器 running）。
# 在 VPS 上、stack 起來後執行：
#   ./scripts/prod-pull-smoke.sh
# 可用環境變數覆寫：
#   ENV_FILE=.env.production COMPOSE_FILE=docker-compose.prod.pull.yml
#
# 任一項失敗即以非 0 結束，方便接在部署腳本後面當 gate。
set -uo pipefail

env_file="${ENV_FILE:-.env.production}"
compose_file="${COMPOSE_FILE:-docker-compose.prod.pull.yml}"
export PROD_ENV_FILE="$env_file"
compose=(docker compose --env-file "$env_file" -f "$compose_file")
api_service="${API_SERVICE:-api}"
web_service="${WEB_SERVICE:-web}"

pass=0
fail=0

GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'

check() {
  local name="$1"; shift
  printf '  %-26s' "$name"
  if "$@" >/dev/null 2>&1; then
    printf '%sPASS%s\n' "$GREEN" "$RST"
    pass=$((pass + 1))
  else
    printf '%sFAIL%s\n' "$RED" "$RST"
    fail=$((fail + 1))
  fi
}

# exec -T：非互動，腳本可用。各服務用容器內既有的 env / runtime，避免外部 DNS/TLS。
api_exec()   { "${compose[@]}" exec -T "$api_service" "$@"; }
web_exec()   { "${compose[@]}" exec -T "$web_service" "$@"; }
redis_exec() { "${compose[@]}" exec -T redis "$@"; }
db_exec()    { "${compose[@]}" exec -T db "$@"; }

http_ok() { # service-exec-fn url
  local fn="$1" url="$2"
  "$fn" python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('$url', timeout=5).status==200 else 1)"
}

echo "${DIM}smoke test → $compose_file (env: $env_file)${RST}"

# 1) API 就緒檢查
check "api /ready"              http_ok api_exec "http://127.0.0.1:8000/ready"
# 2) 公開模組狀態（前端最常打、之前 Redis timeout 會 500 的代表性端點）
check "api /system/module-status" http_ok api_exec "http://127.0.0.1:8000/system/module-status"
# 3) 前端首頁
check "web /"                   web_exec node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 4) Redis ping（用容器內的 REDIS_PASSWORD）
check "redis ping"              redis_exec sh -c 'redis-cli -a "$REDIS_PASSWORD" ping | grep -q PONG'
# 5) DB select 1
check "db select 1"             db_exec sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select 1" | grep -q 1'

echo
if [[ "$fail" -eq 0 ]]; then
  echo "${GREEN}全部通過${RST}（$pass/$((pass + fail))）"
  exit 0
fi
echo "${RED}有 $fail 項失敗${RST}（通過 $pass/$((pass + fail))）"
exit 1
