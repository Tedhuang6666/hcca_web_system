#!/usr/bin/env bash
# scripts/update-openapi.sh  —  從 FastAPI 直接匯出 openapi.json（不需啟動 server）
#
# 用法（在 repo 根目錄）：
#   ./scripts/update-openapi.sh
#
# 接著執行前端型別生成：
#   cd apps/web && npm run generate:types
#
# 完整一條龍（建議加進 pre-commit hook 或 CI）：
#   ./scripts/update-openapi.sh && cd apps/web && npm run generate:types && npm run generate:bridge

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/openapi.json"

echo "==> 從 FastAPI 匯出 OpenAPI schema..."
cd "$REPO_ROOT"

# structlog 會把 JSON 日誌寫入 stdout，需先把 stdout 擋掉再還原
uv run --project apps/api python3 -c "
import json, sys, warnings, io, os
warnings.filterwarnings('ignore')
# 捕捉 create_app() 期間的所有 stdout（structlog JSON 日誌）
_real_stdout_fd = os.dup(1)
_devnull = os.open(os.devnull, os.O_WRONLY)
os.dup2(_devnull, 1)
os.close(_devnull)
try:
    from api.main import create_app
    app = create_app()
    schema = app.openapi()
finally:
    os.dup2(_real_stdout_fd, 1)
    os.close(_real_stdout_fd)
sys.stdout.write(json.dumps(schema, ensure_ascii=False, indent=2))
" > "$OUT"

SIZE=$(wc -c < "$OUT")
ENDPOINTS=$(python3 -c "import json; d=json.load(open('$OUT')); print(len(d.get('paths', {})))")
echo "==> 寫入 $OUT（${SIZE} bytes，${ENDPOINTS} 個端點）"
echo "==> 接著請執行：cd apps/web && npm run generate:types"
