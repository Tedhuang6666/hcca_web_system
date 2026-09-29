#!/usr/bin/env bash
# 從任意 cwd 執行；不更新 lock、不部署、不覆寫生成契約。
set -euo pipefail
cd "$(dirname "$0")/.."

run() {
  printf '\n>'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

mode="${1:-help}"
if [[ $# -gt 0 ]]; then shift; fi
case "$mode" in
  doctor)
    run python3 scripts/check-agent-setup.py --doctor
    ;;
  docs)
    run python3 scripts/check-agent-setup.py
    run python3 -m unittest discover -s scripts/tests -p 'test_agent_setup.py'
    run bash -n scripts/check.sh scripts/update-openapi.sh scripts/refresh-code-index.sh
    ;;
  api)
    run uv run --locked --project apps/api ruff check apps/api/src libs/shared/src
    run uv run --locked --project apps/api ruff format --check apps/api/src libs/shared/src
    run uv run --locked --project apps/api mypy
    run python3 scripts/validate-celery-topology.py
    ;;
  api-test)
    # conftest 會 CREATE/DROP 測試 schema；不要誤用應用資料庫。
    run python3 scripts/check-agent-setup.py --test-database
    export DATABASE_URL="$TEST_DATABASE_URL"
    export REQUIRE_POSTGRES_TEST_DB=true
    export SENTRY_DSN="" POSTHOG_API_KEY="" OTEL_ENABLED=false
    if [[ $# -eq 0 ]]; then set -- apps/api/tests; fi
    run uv run --locked --project apps/api pytest "$@" --tb=short --asyncio-mode=auto
    ;;
  web)
    run npm run --prefix apps/web lint
    run npm run --prefix apps/web check:module-registry
    run npm run --prefix apps/web type-check
    run npm test --prefix apps/web
    run npm run --prefix apps/web build
    ;;
  contract)
    scratch="$(mktemp -d -t hcca-contract.XXXXXXXX)"
    trap 'rm -rf -- "$scratch"' EXIT
    export SENTRY_DSN="" POSTHOG_API_KEY="" OTEL_ENABLED=false
    run uv run --locked --project apps/api python apps/api/scripts/export_openapi.py "$scratch/openapi.json"
    run apps/web/node_modules/.bin/openapi-typescript "$scratch/openapi.json" -o "$scratch/api-types.ts"
    run diff -u apps/web/src/lib/api-types.ts "$scratch/api-types.ts"
    ;;
  graph)
    run node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 1000
    printf '\n請檢查結果：partial/truncated、錯誤、UNKNOWN 皆不得當成全綠。\n'
    ;;
  help|-h|--help)
    printf '%s\n' \
      '用法：bash scripts/check.sh <doctor|docs|api|api-test|web|contract|graph>' \
      'doctor：本機工具與索引診斷（不啟動服務）' \
      'docs：維護入口、文件連結、設定與腳本回歸' \
      'api：後端靜態檢查（不包含 DB 測試）' \
      'api-test [pytest 參數]：明確指定本機 PostgreSQL *_test 資料庫後測試' \
      'web：lint、模組對照、型別、Vitest coverage、build' \
      'contract：在暫存目錄重建 OpenAPI 型別並比較，不改工作樹' \
      'graph：提交前圖譜分析，需人工確認完整性'
    ;;
  *)
    printf '未知檢查：%s\n' "$mode" >&2
    exit 2
    ;;
esac
