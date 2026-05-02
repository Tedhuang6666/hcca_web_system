#!/usr/bin/env bash
# =============================================================================
# dev.sh — 校園自治整合平台一鍵開發環境啟動腳本
# 使用方式：bash dev.sh
# 注意：此腳本須以 LF 換行符儲存（不可為 CRLF）
#       若在 WSL/Linux 出現錯誤，請先執行：dos2unix dev.sh
#       或在 PowerShell 執行：(Get-Content dev.sh -Raw) -replace "`r`n","`n" | Set-Content dev.sh -NoNewline
# =============================================================================
set -euo pipefail

# ── 顏色輸出輔助 ───────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[DEV]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }

# ── 腳本根目錄（無論從哪裡呼叫都正確）────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 載入 .env ─────────────────────────────────────────────────────────────────
ENV_FILE="${REPO_ROOT}/.env"
if [[ -f "$ENV_FILE" ]]; then
    info "載入環境變數：$ENV_FILE"
    # 過濾空行與注釋，匯出其餘變數
    set -a
    # shellcheck disable=SC1090
    source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')
    set +a
    success ".env 載入完成"
else
    warn ".env 不存在，使用應用程式預設值（建議複製 .env.example 並填入實際數值）"
fi

# ── 依賴檢查 ───────────────────────────────────────────────────────────────────
_require() {
    if ! command -v "$1" &>/dev/null; then
        error "找不到指令：$1 — 請先安裝後再執行此腳本"
        exit 1
    fi
}
_require docker
_require uv
_require node
_require npm

# ── 清理函式（Ctrl+C 時關閉前景行程）─────────────────────────────────────────
_cleanup() {
    echo ""
    info "收到中止訊號，停止所有開發行程..."
    # 終止背景 PID（若已記錄）
    [[ -n "${API_PID:-}" ]]  && kill "$API_PID"  2>/dev/null || true
    [[ -n "${WEB_PID:-}" ]]  && kill "$WEB_PID"  2>/dev/null || true
    success "開發環境已關閉"
}
trap _cleanup INT TERM

# ── 1. 啟動基礎設施（PostgreSQL + Redis）──────────────────────────────────────
info "啟動 Docker 基礎設施（db + redis）..."
docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d db redis

info "等待 PostgreSQL 就緒..."
until docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T db \
    pg_isready -U postgres -q 2>/dev/null; do
    sleep 1
done
success "PostgreSQL 已就緒"

info "等待 Redis 就緒..."
until docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T redis \
    redis-cli ping 2>/dev/null | grep -q PONG; do
    sleep 1
done
success "Redis 已就緒"

# ── 2. 同步 Python 依賴 ────────────────────────────────────────────────────────
info "uv sync — 同步 Python 依賴..."
(cd "${REPO_ROOT}" && uv sync)
success "Python 依賴同步完成"

# ── 3. 執行 Alembic Migration ─────────────────────────────────────────────────
info "執行資料庫 Migration（alembic upgrade head）..."
(cd "${REPO_ROOT}" && uv run alembic upgrade head) \
    && success "Migration 完成" \
    || warn "Migration 執行失敗或無新版本，請手動確認"

# ── 4. 啟動 FastAPI 後端（背景，熱重載）───────────────────────────────────────
info "啟動 FastAPI 後端（port 8000，熱重載）..."
(
    cd "${REPO_ROOT}"
    uv run uvicorn api:app \
        --host 0.0.0.0 \
        --port 8000 \
        --reload \
        --reload-dir apps/api/src \
        --app-dir apps/api/src
) &
API_PID=$!
success "FastAPI 已啟動 PID=${API_PID} → http://localhost:8000/docs"

# ── 5. 安裝前端依賴並啟動 Next.js（背景）──────────────────────────────────────
WEB_DIR="${REPO_ROOT}/apps/web"
info "檢查 Next.js 依賴..."
if [[ ! -d "${WEB_DIR}/node_modules" ]]; then
    info "node_modules 不存在，執行 npm install..."
    (cd "${WEB_DIR}" && npm install)
fi

info "啟動 Next.js 開發伺服器（port 3000）..."
(cd "${WEB_DIR}" && npm run dev) &
WEB_PID=$!
success "Next.js 已啟動 PID=${WEB_PID} → http://localhost:3000"

# ── 完成提示 ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 開發環境已就緒！${NC}"
echo -e "  API Docs  : ${CYAN}http://localhost:8000/docs${NC}"
echo -e "  Web UI    : ${CYAN}http://localhost:3000${NC}"
echo -e "  按 Ctrl+C 停止所有服務"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""

# 等待背景行程（保持腳本存活以接收 Ctrl+C）
wait "$API_PID" "$WEB_PID"
