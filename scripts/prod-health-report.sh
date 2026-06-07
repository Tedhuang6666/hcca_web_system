#!/usr/bin/env bash
# 部署後健康/資源回報：容器狀態、重啟次數、CPU/記憶體、最近錯誤日誌、主機資源。
# smoke test 確認「服務活著」，這支則確認「沒在冒煙」（高 CPU / 重啟 / OOM / 大量錯誤）。
# 用法: ./scripts/prod-health-report.sh [env_file] [compose_file]
# 任一硬問題即以非 0 結束，方便當部署 gate。
set -uo pipefail

env_file="${1:-${ENV_FILE:-.env.production}}"
compose_file="${2:-${COMPOSE_FILE:-docker-compose.prod.pull.yml}}"
export PROD_ENV_FILE="$env_file"
compose=(docker compose --env-file "$env_file" -f "$compose_file")

RED=$'\033[31m'; GREEN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
problems=0

echo "${DIM}health report → $compose_file (env: $env_file)${RST}"

ids=$("${compose[@]}" ps -q)
if [ -z "$ids" ]; then
  echo "${RED}沒有任何容器在跑${RST}"; exit 1
fi

echo; echo "▶ 容器狀態 / 重啟次數"
for id in $ids; do
  name=$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')
  state=$(docker inspect -f '{{.State.Status}}' "$id")
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$id")
  restarts=$(docker inspect -f '{{.RestartCount}}' "$id")
  flag=""
  [ "$state" != "running" ]   && { flag="${RED}[非 running]${RST}"; problems=$((problems+1)); }
  [ "$health" = "unhealthy" ] && { flag="$flag ${RED}[unhealthy]${RST}"; problems=$((problems+1)); }
  [ "${restarts:-0}" -ge 3 ]  && { flag="$flag ${YEL}[重啟 ${restarts} 次]${RST}"; problems=$((problems+1)); }
  printf '  %-22s %-9s health=%-9s restarts=%-3s %b\n' "$name" "$state" "$health" "$restarts" "$flag"
done

echo; echo "▶ CPU / 記憶體（單次取樣）"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' $ids
hot=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' $ids \
  | awk '{gsub("%","",$2); if ($2+0 > 85) print "    "$1" "$2"%"}')
if [ -n "$hot" ]; then echo "${YEL}⚠ 高 CPU（>85%）:${RST}"; echo "$hot"; problems=$((problems+1)); fi

echo; echo "▶ 最近 10 分鐘錯誤日誌掃描"
pat='Traceback|CRITICAL|FATAL|OOM|OutOfMemory|Killed process|panic:|Segmentation fault|Out of memory'
found=0
for id in $ids; do
  name=$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')
  hits=$(docker logs --since 10m "$id" 2>&1 | grep -E "$pat" | tail -5)
  if [ -n "$hits" ]; then
    echo "  ${YEL}$name${RST}:"; echo "$hits" | sed 's/^/      /'
    problems=$((problems+1)); found=1
  fi
done
[ "$found" -eq 0 ] && echo "  乾淨，無嚴重錯誤關鍵字"

echo; echo "▶ 主機資源"
echo "  $(uptime | sed 's/^ *//')"
free -h  | awk 'NR==1||/Mem/{print "  "$0}'
df -h /  | awk 'NR==1||NR==2{print "  "$0}'

echo
if [ "$problems" -eq 0 ]; then
  echo "${GREEN}部署後健康檢查通過，無異常${RST}"; exit 0
fi
echo "${RED}發現 $problems 項需注意（見上）${RST}"; exit 1
