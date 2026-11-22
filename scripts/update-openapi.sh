#!/usr/bin/env bash
# 從 FastAPI 匯出穩定排序的契約，不需 API server；成功後才取代 openapi.json。
set -euo pipefail
cd "$(dirname "$0")/.."
scratch="$(mktemp -t hcca-openapi.XXXXXXXX.json)"
trap 'rm -f -- "$scratch"' EXIT
SENTRY_DSN="" POSTHOG_API_KEY="" OTEL_ENABLED=false uv run --locked --project apps/api \
  python apps/api/scripts/export_openapi.py "$scratch"
mv -- "$scratch" openapi.json
printf '%s\n' '已更新 openapi.json；接著執行：' \
  'npm run --prefix apps/web generate:types' \
  'npm run --prefix apps/web generate:bridge'
