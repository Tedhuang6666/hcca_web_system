#!/usr/bin/env bash
# =============================================================================
# dev.sh — 校園自治整合平台一鍵開發環境啟動腳本（自動排錯版）
# 使用方式：bash dev.sh
# 注意：此腳本須以 LF 換行符儲存（CRLF 會自動轉換但建議編輯器設定 LF）
#
# 自動處理項目：
#   - CRLF → LF 轉換
#   - .env 從 .env.example 自動複製
#   - .env 缺漏 .env.example 中的 key 時提示（避免靜默吃預設）
#   - 舊 dev.sh / uvicorn / next-server 殘留行程清理
#   - port 3000 / 8000 佔用者自動終止
#   - 孤兒 / 死亡 Docker 容器自動移除
#   - PostgreSQL 資料庫不存在自動建立
#   - Meilisearch 不在線時自動以 Docker 啟動（已有 native 7700 則沿用）
#   - PostHog / LINE Bot 啟動前 smoke check（cloud 服務憑證有效性）
#   - Alembic Migration 落後自動升級
#   - Migration 前自動終止會阻塞 ALTER TABLE 的 idle-in-transaction 殭屍連線
#   - Model 與 Migration drift（alembic check）偵測並提示如何補 migration
#   - Email Celery worker 自動啟動，避免寄信任務只排隊不送出
#   - uv sync 失敗自動清 .venv 重試
#   - npm install 失敗自動清 node_modules 重試
#   - Docker daemon 沒在跑時自動嘗試啟動
# =============================================================================
set -uo pipefail  # 不使用 -e，改用明確的錯誤處理流程實現自動修復

# ── 顏色與符號（自動偵測 TTY；NO_COLOR=1 可強制關閉） ────────────────────
if [[ -t 1 && "${TERM:-dumb}" != "dumb" && -z "${NO_COLOR:-}" ]]; then
    C_BOLD=$'\033[1m'      ; C_DIM=$'\033[2m'
    C_RED=$'\033[38;5;203m'; C_GREEN=$'\033[38;5;114m'
    C_YELLOW=$'\033[38;5;221m'; C_BLUE=$'\033[38;5;75m'
    C_CYAN=$'\033[38;5;87m';  C_MAGENTA=$'\033[38;5;176m'
    C_GRAY=$'\033[38;5;245m'; C_RESET=$'\033[0m'
else
    C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW=''
    C_BLUE='' C_CYAN='' C_MAGENTA='' C_GRAY='' C_RESET=''
fi

# 著色的類別標籤：只有前綴有顏色，後面內文一律保持終端預設色
info()    { printf '  %sINFO %s  %s\n' "$C_CYAN"    "$C_RESET" "$*"; }
success() { printf '  %sOK   %s  %s\n' "$C_GREEN"   "$C_RESET" "$*"; }
warn()    { printf '  %sWARN %s  %s\n' "$C_YELLOW"  "$C_RESET" "$*"; }
error()   { printf '  %sERROR%s  %s\n' "$C_RED"     "$C_RESET" "$*" >&2; }
fix()     { printf '  %sFIX  %s  %s\n' "$C_MAGENTA" "$C_RESET" "$*"; }
step()    {
    printf '\n%s▶%s %s\n' "$C_CYAN" "$C_RESET" "$*"
}

_is_dev_console_noise() {
    local line="$1"
    [[ "$line" == *"WatchFiles detected changes in"* ]] && return 0
    [[ "$line" == "INFO:     Shutting down"* ]] && return 0
    [[ "$line" == "INFO:     Waiting for application startup."* ]] && return 0
    [[ "$line" == "INFO:     Waiting for application shutdown."* ]] && return 0
    [[ "$line" == "INFO:     Application startup complete."* ]] && return 0
    [[ "$line" == "INFO:     Application shutdown complete."* ]] && return 0
    [[ "$line" == "INFO:     Started server process "* ]] && return 0
    [[ "$line" == "INFO:     Finished server process "* ]] && return 0
    [[ "$line" == "INFO:     connection open"* ]] && return 0
    [[ "$line" == "INFO:     connection closed"* ]] && return 0
    [[ "$line" == *"\"WebSocket /ws/"*"[accepted]"* ]] && return 0
    [[ "$line" == *"WS 連線建立"* ]] && return 0
    [[ "$line" == *"WS 連線中斷"* ]] && return 0
    [[ "$line" == *"WS Redis pub/sub listener started"* ]] && return 0
    [[ "$line" == *"WS Redis pub/sub listener stopped"* ]] && return 0
    [[ "$line" == *"Sentry initialized"* ]] && return 0
    [[ "$line" == *"PostHog initialized"* ]] && return 0
    [[ "$line" == *"prometheus_client not installed"* ]] && return 0
    [[ "$line" == *"Module startup checks passed"* ]] && return 0
    return 1
}

# Log 串流：raw 寫進 $log_file（FD 3），透過 sed 對「token」上色後丟到終端
# 著色範圍：HTTP method（GET/POST/...）、status code（2xx/3xx/4xx/5xx）、
# 嚴重等級關鍵字（ERROR/Traceback/WARNING ...）。其餘內文保持白色。
_stream_log() {
    local name="$1"
    local log_file="$2"
    local prefix_color="$3"
    local line=""

    {
        while IFS= read -r line || [[ -n "$line" ]]; do
            printf '%s\n' "$line" >&3     # raw → log 檔
            if [[ "${DEV_VERBOSE_LOGS:-0}" != "1" ]] && _is_dev_console_noise "$line"; then
                continue
            fi
            printf '%s\n' "$line"          # 給 sed 著色 → 終端
        done
    } 3>>"$log_file" | sed -E -u \
        -e "s/([[:space:]\"])(2[0-9]{2})([[:space:]]|\$)/\1${C_GREEN}\2${C_RESET}\3/g" \
        -e "s/([[:space:]\"])(3[0-9]{2})([[:space:]]|\$)/\1${C_CYAN}\2${C_RESET}\3/g" \
        -e "s/([[:space:]\"])(4[0-9]{2})([[:space:]]|\$)/\1${C_YELLOW}\2${C_RESET}\3/g" \
        -e "s/([[:space:]\"])(5[0-9]{2})([[:space:]]|\$)/\1${C_RED}\2${C_RESET}\3/g" \
        -e "s/\\b(GET)\\b/${C_CYAN}\\1${C_RESET}/g" \
        -e "s/\\b(POST)\\b/${C_GREEN}\\1${C_RESET}/g" \
        -e "s/\\b(PUT|PATCH)\\b/${C_YELLOW}\\1${C_RESET}/g" \
        -e "s/\\b(DELETE)\\b/${C_RED}\\1${C_RESET}/g" \
        -e "s/\\b(OPTIONS|HEAD)\\b/${C_GRAY}\\1${C_RESET}/g" \
        -e "s/(Traceback|Exception)/${C_RED}\\1${C_RESET}/g" \
        -e "s/\\b(ERROR|FAILED|FAIL)\\b/${C_RED}\\1${C_RESET}/g" \
        -e "s/\\b(WARNING|WARN|Deprecated|deprecated)\\b/${C_YELLOW}\\1${C_RESET}/g" \
        -e "s|^|${prefix_color}[${name}]${C_RESET} |"
}

# ── 全域變數 ──────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_TIME=$(date +%s)
API_PID=""
EMAIL_WORKER_PID=""
WEB_PID=""
DISCORD_PID=""
API_LOG="${REPO_ROOT}/.dev-api.log"
EMAIL_WORKER_LOG="${REPO_ROOT}/.dev-email-worker.log"
WEB_LOG="${REPO_ROOT}/.dev-web.log"
DISCORD_LOG="${REPO_ROOT}/.dev-discord.log"

# ── 結束清理：終止背景行程（含孤兒子行程） ───────────────────────────
_cleanup() {
    local sig="${1:-EXIT}"
    echo ""
    info "收到 ${sig} 訊號，停止所有開發行程..."
    for pid in "$API_PID" "$EMAIL_WORKER_PID" "$WEB_PID" "$DISCORD_PID"; do
        [[ -n "$pid" ]] || continue
        kill -TERM "$pid" 2>/dev/null || true
        # 順便殺掉子行程（uvicorn reload watcher / next-server 等）
        pkill -TERM -P "$pid" 2>/dev/null || true
    done
    sleep 1
    for pid in "$API_PID" "$EMAIL_WORKER_PID" "$WEB_PID" "$DISCORD_PID"; do
        [[ -n "$pid" ]] || continue
        kill -KILL "$pid" 2>/dev/null || true
        pkill -KILL -P "$pid" 2>/dev/null || true
    done
    # 收尾本腳本所有子行程
    pkill -P $$ 2>/dev/null || true
    success "開發環境已關閉（共執行 $(( $(date +%s) - START_TIME )) 秒）"
    exit 0
}
trap '_cleanup INT'  INT
trap '_cleanup TERM' TERM

# ──────────────────────────────────────────────────────────────────────────
# 0. 環境前置檢查
# ──────────────────────────────────────────────────────────────────────────
step "0/8 環境檢查"

# 0.1 確認在 WSL/Linux（不是 Git Bash on Windows）
case "${OSTYPE:-}" in
    msys|win32|cygwin)
        error "偵測到 Windows shell ($OSTYPE)。本專案必須在 WSL Ubuntu 中執行"
        error "請改用：wsl -d Ubuntu -- bash -lc 'cd ~/projects/main && bash dev.sh'"
        exit 1
        ;;
esac

# 0.2 自動修正 CRLF 換行（Windows 編輯器常見問題）
if head -1 "${BASH_SOURCE[0]}" | grep -q $'\r$'; then
    warn "偵測到 CRLF 換行，自動轉換為 LF..."
    sed -i 's/\r$//' "${BASH_SOURCE[0]}" 2>/dev/null || {
        error "轉換 CRLF 失敗，請手動執行：sed -i 's/\\r\$//' dev.sh"
        exit 1
    }
    fix "CRLF 已修正，請重新執行 bash dev.sh"
    exit 0
fi

# 0.3 必要工具檢查
_require() {
    local cmd="$1"; local hint="${2:-}"
    if ! command -v "$cmd" &>/dev/null; then
        error "找不到指令：$cmd"
        [[ -n "$hint" ]] && error "安裝方式：$hint"
        return 1
    fi
}
_missing=0
_require docker "https://docs.docker.com/desktop/install/windows-install/（並啟用 WSL Integration）" || _missing=1
_require uv     "curl -LsSf https://astral.sh/uv/install.sh | sh" || _missing=1
_require node   "nvm install 20 && nvm use 20" || _missing=1
_require npm    "（隨 node 安裝）" || _missing=1
_require curl   "sudo apt install -y curl" || _missing=1
[[ $_missing -eq 1 ]] && exit 1

# 0.4 Node 版本（package.json engines.node >=20.9.0）
NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=${NODE_VERSION%%.*}
if [[ "$NODE_MAJOR" -lt 20 ]]; then
    error "Node.js 版本過舊：v${NODE_VERSION}（需要 >=20.9.0）"
    error "升級：nvm install 20 && nvm use 20"
    exit 1
fi

# 0.5 Docker daemon 可用性，必要時嘗試啟動
if ! docker info &>/dev/null; then
    warn "Docker daemon 無回應，嘗試自動啟動..."
    if command -v systemctl &>/dev/null && systemctl list-unit-files 2>/dev/null | grep -q '^docker\.service'; then
        sudo -n systemctl start docker 2>/dev/null || sudo systemctl start docker 2>/dev/null || true
    else
        sudo -n service docker start 2>/dev/null || sudo service docker start 2>/dev/null || true
    fi
    sleep 2
    if ! docker info &>/dev/null; then
        error "Docker daemon 啟動失敗"
        error "WSL2: 請開啟 Docker Desktop，並在 Settings → Resources → WSL Integration 勾選 Ubuntu"
        error "純 Linux: sudo service docker start"
        exit 1
    fi
    fix "Docker daemon 已啟動"
fi

# 0.6 docker compose v2 偵測
if ! docker compose version &>/dev/null; then
    error "需要 Docker Compose V2（docker compose），請升級 Docker Desktop / Engine"
    exit 1
fi

# 0.7 磁碟空間警告（剩 < 2GB 提醒）
AVAIL_KB=$(df -P "$REPO_ROOT" | tail -1 | awk '{print $4}')
if [[ -n "$AVAIL_KB" && "$AVAIL_KB" -lt 2097152 ]]; then
    warn "磁碟剩餘空間僅 $(( AVAIL_KB / 1024 )) MB，可能影響 docker volume / build"
fi

success "環境檢查通過（Node v${NODE_VERSION}, Docker $(docker --version | awk '{print $3}' | tr -d ',')）"

# ──────────────────────────────────────────────────────────────────────────
# 1. .env 自動準備
# ──────────────────────────────────────────────────────────────────────────
step "1/8 載入環境變數"

ENV_FILE="${REPO_ROOT}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "${REPO_ROOT}/.env.example" ]]; then
        warn ".env 不存在，自動從 .env.example 複製"
        cp "${REPO_ROOT}/.env.example" "$ENV_FILE"
        fix ".env 已建立（請後續視需求填入實際 OAuth / LINE / VAPID 金鑰）"
    else
        error ".env 和 .env.example 皆不存在，無法繼續"
        exit 1
    fi
fi

info "載入 $ENV_FILE..."
# 保留 JSON list 內的雙引號（["..."] 不可被 source 吃掉）
while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # 移除可能的 CRLF
    line="${line%$'\r'}"
    key="${line%%=*}"
    value="${line#*=}"
    # 驗證 key 是合法環境變數名
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "${key}=${value}"
done < "$ENV_FILE"
success ".env 載入完成"

# 1.x .env vs .env.example key 對齊檢查（缺漏多為非必填，但提醒避免靜默吃預設）
if [[ -f "${REPO_ROOT}/.env.example" ]]; then
    MISSING_KEYS=$(comm -23 \
        <(grep -oE '^[A-Z_][A-Z0-9_]*=' "${REPO_ROOT}/.env.example" | sed 's/=$//' | sort -u) \
        <(grep -oE '^[A-Z_][A-Z0-9_]*=' "$ENV_FILE"                 | sed 's/=$//' | sort -u))
    if [[ -n "$MISSING_KEYS" ]]; then
        MISSING_COUNT=$(echo "$MISSING_KEYS" | wc -l)
        warn ".env 缺漏 .env.example 中的 ${MISSING_COUNT} 個 key（多為非必填，建議補齊以利對照）："
        echo "$MISSING_KEYS" | sed "s/^/    ${C_DIM}·${C_RESET} /"
    fi
fi

# ──────────────────────────────────────────────────────────────────────────
# 2. 舊行程與 port 佔用清理
# ──────────────────────────────────────────────────────────────────────────
step "2/8 清理舊行程與 port 佔用"

# 2.1 終止舊的 dev.sh 實例（不含自己）
OLD_DEV_PIDS=$(pgrep -f "bash[[:space:]]+.*dev\.sh" 2>/dev/null | grep -v "^$$\$" || true)
if [[ -n "$OLD_DEV_PIDS" ]]; then
    warn "偵測到舊的 dev.sh 行程：$(echo $OLD_DEV_PIDS | tr '\n' ' ')→ 終止"
    echo "$OLD_DEV_PIDS" | xargs -r kill -TERM 2>/dev/null || true
    sleep 1
    echo "$OLD_DEV_PIDS" | xargs -r kill -KILL 2>/dev/null || true
fi

# 2.2 取得 port 上的 LISTEN PID（多重 fallback）
_pids_on_port() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null | sort -u
    elif command -v ss &>/dev/null; then
        ss -lntp 2>/dev/null | awk -v p=":${port}\$" '$4 ~ p {
            while (match($0, /pid=[0-9]+/)) {
                print substr($0, RSTART+4, RLENGTH-4)
                $0 = substr($0, RSTART + RLENGTH)
            }
        }' | sort -u
    elif command -v fuser &>/dev/null; then
        fuser ${port}/tcp 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u
    fi
}

_kill_port() {
    local port="$1"; local name="$2"
    local pids; pids=$(_pids_on_port "$port")
    [[ -z "$pids" ]] && return 0
    local procinfo; procinfo=$(ps -o pid=,comm= -p $pids 2>/dev/null | tr -s ' ' | tr '\n' ';' | sed 's/;$//')
    warn "Port ${port} (${name}) 被佔用：${procinfo} → 終止"
    echo "$pids" | xargs -r kill -TERM 2>/dev/null || true
    sleep 1
    pids=$(_pids_on_port "$port")
    if [[ -n "$pids" ]]; then
        echo "$pids" | xargs -r kill -KILL 2>/dev/null || true
        sleep 1
    fi
    pids=$(_pids_on_port "$port")
    if [[ -n "$pids" ]]; then
        error "Port ${port} 仍被佔用（PID: ${pids}），可能是系統服務或 Docker 容器"
        error "Docker: docker ps  → 找到佔用容器並 docker stop"
        error "系統服務: sudo lsof -i :${port}  → 識別後手動處理"
        return 1
    fi
    fix "Port ${port} 已釋放"
}
_kill_port 3000 "Next.js" || exit 1
_kill_port 8000 "FastAPI" || exit 1

# 2.3 清理孤兒 uvicorn / next-server / next dev / celery worker / discord_worker
# Celery 重點：殘留 worker 會跟新 worker 共用 -n nodename，造成 DuplicateNodenameWarning。
ORPHAN_PATTERN="uvicorn[[:space:]]+api:app|next-server|next[[:space:]]+dev|celery.*worker|api\\.discord_worker"
ORPHAN=$(pgrep -f "$ORPHAN_PATTERN" 2>/dev/null || true)
if [[ -n "$ORPHAN" ]]; then
    warn "終止孤兒行程：$(echo $ORPHAN | tr '\n' ' ')"
    echo "$ORPHAN" | xargs -r kill -TERM 2>/dev/null || true
    sleep 1
    pkill -KILL -f "$ORPHAN_PATTERN" 2>/dev/null || true
fi

success "舊行程清理完成"

# ──────────────────────────────────────────────────────────────────────────
# 3. Docker 基礎設施
# ──────────────────────────────────────────────────────────────────────────
step "3/8 啟動 Docker 基礎設施（db + redis）"

# 3.1 移除狀態異常的孤兒容器
for name in campus_db campus_redis; do
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
        STATUS=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo "unknown")
        if [[ "$STATUS" != "running" ]]; then
            warn "容器 $name 狀態為 ${STATUS}，自動移除以重新建立"
            docker rm -f "$name" >/dev/null 2>&1 || true
        fi
    fi
done

# 3.2 啟動 db + redis；失敗則 down --remove-orphans 後重試
info "docker compose up -d db redis..."
if ! docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d db redis 2>&1; then
    warn "啟動失敗，清理孤兒容器後重試..."
    docker compose -f "${REPO_ROOT}/docker-compose.yml" down --remove-orphans 2>/dev/null || true
    if ! docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d db redis; then
        error "Docker 基礎設施啟動失敗，最近 log："
        docker compose -f "${REPO_ROOT}/docker-compose.yml" logs --tail=30 db redis 2>&1 || true
        exit 1
    fi
fi

# 3.3 等待 PostgreSQL 健康（最多 60 秒）
info "等待 PostgreSQL 健康..."
for i in $(seq 1 60); do
    if docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T db \
            pg_isready -U postgres -q 2>/dev/null; then
        success "PostgreSQL 已就緒"
        break
    fi
    if [[ $i -eq 60 ]]; then
        error "PostgreSQL 60 秒內未就緒，最近 log："
        docker compose -f "${REPO_ROOT}/docker-compose.yml" logs --tail=40 db
        exit 1
    fi
    sleep 1
done

# 3.4 等待 Redis 健康（最多 30 秒）
info "等待 Redis 健康..."
for i in $(seq 1 30); do
    if docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T redis \
            redis-cli ping 2>/dev/null | grep -q PONG; then
        success "Redis 已就緒"
        break
    fi
    if [[ $i -eq 30 ]]; then
        error "Redis 30 秒內未就緒，最近 log："
        docker compose -f "${REPO_ROOT}/docker-compose.yml" logs --tail=40 redis
        exit 1
    fi
    sleep 1
done

# 3.5 資料庫不存在則自動建立
DB_NAME="${POSTGRES_DB:-campus_platform}"
if ! docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T db \
        psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null | grep -q 1; then
    warn "資料庫 ${DB_NAME} 不存在，自動建立"
    docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T db \
        psql -U postgres -c "CREATE DATABASE \"${DB_NAME}\";" >/dev/null
    fix "資料庫 ${DB_NAME} 已建立"
fi

# ──────────────────────────────────────────────────────────────────────────
# 4. Meilisearch + Cloud 服務（PostHog / LINE Bot）smoke check
#    - Meilisearch：native 7700 已在線時沿用，否則用 docker compose 啟一個
#    - PostHog：cloud 服務，僅做 /decide ping 驗證 API key
#    - LINE Bot：cloud 服務，呼叫 /v2/bot/info 驗證 access token
#    任何一項失敗只發 warn，不中止啟動（沒設定也應該能跑）
# ──────────────────────────────────────────────────────────────────────────
step "4/8 全站搜尋與外部服務（Meilisearch + PostHog + LINE Bot）"

# 4.1 Meilisearch ──────────────────────────────────────────────────────────
MEILI_URL_LOCAL="${MEILISEARCH_URL:-http://localhost:7700}"
MEILI_KEY="${MEILISEARCH_API_KEY:-}"

_meili_health() {
    curl -fsS --max-time 3 "${MEILI_URL_LOCAL%/}/health" >/dev/null 2>&1
}
_meili_auth_ok() {
    # 沒設 key → 視為通過（dev 環境允許）
    [[ -z "$MEILI_KEY" ]] && return 0
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer ${MEILI_KEY}" \
        --max-time 3 "${MEILI_URL_LOCAL%/}/version" 2>/dev/null || echo "000")
    [[ "$code" == "200" ]]
}

if _meili_health; then
    if _meili_auth_ok; then
        success "Meilisearch 已在線並通過驗證（${MEILI_URL_LOCAL}）"
    else
        warn "Meilisearch 在線但 MEILISEARCH_API_KEY 驗證失敗，請確認 .env 與 master key 一致"
    fi
else
    info "Meilisearch 未在線，嘗試以 Docker 啟動 campus_meilisearch..."
    if docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d meilisearch 2>&1 | tail -5; then
        for i in $(seq 1 30); do
            if _meili_health; then
                success "Meilisearch 已透過 Docker 啟動（${MEILI_URL_LOCAL}）"
                break
            fi
            if [[ $i -eq 30 ]]; then
                warn "Meilisearch 30 秒內未回應，搜尋將自動 fallback DB 搜尋"
                docker compose -f "${REPO_ROOT}/docker-compose.yml" logs --tail=20 meilisearch 2>&1 || true
            fi
            sleep 1
        done
    else
        warn "Docker 啟動 Meilisearch 失敗（可能 port 被佔用）；搜尋將 fallback DB"
    fi
fi

# 4.2 PostHog（cloud；POSTHOG_API_KEY 從 apps/api/.env 讀取，root .env 沒有也 OK） ─
PH_HOST_FOR_CHECK="${POSTHOG_HOST:-${NEXT_PUBLIC_POSTHOG_HOST:-https://us.i.posthog.com}}"
PH_KEY_FOR_CHECK="${POSTHOG_API_KEY:-${NEXT_PUBLIC_POSTHOG_KEY:-}}"
# 若 root .env 沒有 POSTHOG_API_KEY，從 apps/api/.env 讀
if [[ -z "$PH_KEY_FOR_CHECK" && -f "${REPO_ROOT}/apps/api/.env" ]]; then
    PH_KEY_FOR_CHECK=$(grep -E '^POSTHOG_API_KEY=' "${REPO_ROOT}/apps/api/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
fi
if [[ -z "$PH_KEY_FOR_CHECK" ]]; then
    info "PostHog 未設定（POSTHOG_API_KEY 空）→ 分析事件 no-op，跳過"
else
    PH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
        -X POST "${PH_HOST_FOR_CHECK%/}/decide/?v=3" \
        -H "Content-Type: application/json" \
        -d "{\"api_key\":\"${PH_KEY_FOR_CHECK}\",\"distinct_id\":\"dev-smoke\"}" 2>/dev/null || echo "000")
    if [[ "$PH_CODE" == "200" ]]; then
        success "PostHog 已連線（host=${PH_HOST_FOR_CHECK}）"
    else
        warn "PostHog 連線失敗 HTTP=${PH_CODE}（host=${PH_HOST_FOR_CHECK}）；分析事件可能失效"
    fi
fi

# 4.3 LINE Bot（cloud；webhook 由 FastAPI /line/webhook 提供） ──────────────
if [[ -z "${LINE_CHANNEL_ACCESS_TOKEN:-}" || -z "${LINE_CHANNEL_SECRET:-}" ]]; then
    info "LINE Bot 未完整設定（缺 token 或 secret）→ /line/webhook 將停用，跳過"
else
    LINE_INFO=$(curl -sS --max-time 5 \
        -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
        "https://api.line.me/v2/bot/info" 2>/dev/null || echo "")
    if echo "$LINE_INFO" | grep -q '"userId"'; then
        LINE_NAME=$(echo "$LINE_INFO" | sed -nE 's/.*"displayName":"([^"]+)".*/\1/p')
        LINE_BASIC=$(echo "$LINE_INFO" | sed -nE 's/.*"basicId":"([^"]+)".*/\1/p')
        success "LINE Bot 已連線（${LINE_NAME} ${LINE_BASIC}）"
        info "  webhook 路徑：POST /line/webhook（對外需 HTTPS 通道，例：cloudflared / ngrok）"
    else
        warn "LINE Bot access token 驗證失敗：${LINE_INFO:0:200}"
    fi
fi

# ──────────────────────────────────────────────────────────────────────────
# 5. Python 依賴同步
# ──────────────────────────────────────────────────────────────────────────
step "5/8 同步 Python 依賴（uv sync）"

if ! (cd "${REPO_ROOT}" && uv sync --project apps/api); then
    warn "uv sync 失敗，清理 .venv 後重試..."
    rm -rf "${REPO_ROOT}/.venv" "${REPO_ROOT}/apps/api/.venv" 2>/dev/null || true
    if ! (cd "${REPO_ROOT}" && uv sync --project apps/api); then
        error "uv sync 仍然失敗，請檢查 pyproject.toml / uv.lock"
        exit 1
    fi
    fix "已清理 .venv 並重新同步"
fi
success "Python 依賴同步完成"

# ──────────────────────────────────────────────────────────────────────────
# 5. Alembic Migration（自動偵測落後並升級）
# ──────────────────────────────────────────────────────────────────────────
step "6/8 資料庫 Migration"

_alembic() {
    (
        cd "${REPO_ROOT}/apps/api"
        export PYTHONPATH="${REPO_ROOT}/apps/api/src"
        uv run --project "${REPO_ROOT}/apps/api" python -m alembic "$@"
    )
}

# 終止會阻塞 ALTER TABLE 的殭屍連線（前次 API crash / kill -9 留下的 idle-in-transaction）
_kill_stale_db_connections() {
    local db="${1:-${POSTGRES_DB:-campus_platform}}"
    local cnt
    cnt=$(docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T db \
        psql -U postgres -tAc "
            SELECT COUNT(*) FROM pg_stat_activity
            WHERE datname='${db}'
              AND state IN ('idle in transaction','idle in transaction (aborted)')
              AND pid <> pg_backend_pid()
        " 2>/dev/null | tr -d '[:space:]')
    [[ "$cnt" =~ ^[0-9]+$ ]] || cnt=0
    if (( cnt > 0 )); then
        warn "偵測到 ${cnt} 條 idle-in-transaction 殭屍連線，會阻塞 Migration 的 ALTER TABLE → 終止"
        docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T db \
            psql -U postgres -d "${db}" -c "
                SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                WHERE datname='${db}'
                  AND state IN ('idle in transaction','idle in transaction (aborted)')
                  AND pid <> pg_backend_pid()
            " >/dev/null 2>&1 || true
        fix "殭屍連線已終止"
    fi
}

info "檢查 Migration 狀態..."
CURRENT_REV=$(_alembic current 2>/dev/null | grep -oE '[0-9a-f]{8,}' | tail -1 || echo "")
HEAD_REV=$(_alembic heads 2>/dev/null | grep -oE '[0-9a-f]{8,}' | tail -1 || echo "")

if [[ -n "$CURRENT_REV" && "$CURRENT_REV" == "$HEAD_REV" ]]; then
    success "Migration 已是最新（${HEAD_REV:0:12}）"
else
    if [[ -z "$CURRENT_REV" ]]; then
        info "資料庫尚未套用 Migration（首次啟動）→ 執行 upgrade head"
    else
        info "Migration 落後：${CURRENT_REV:0:8} → ${HEAD_REV:0:8}，自動升級"
    fi
    _kill_stale_db_connections
    if ! _alembic upgrade head; then
        # 第一次失敗可能因為新出現的殭屍連線；再清一次重試
        warn "Migration 失敗，重新清理殭屍連線後再試一次..."
        _kill_stale_db_connections
        if ! _alembic upgrade head; then
            error "Migration 失敗，當前狀態："
            _alembic current 2>&1 || true
            echo "—— heads ——"
            _alembic heads 2>&1 || true
            error "請手動排查：uv run --project apps/api alembic upgrade head"
            exit 1
        fi
    fi
    success "Migration 升級完成"
fi

# 6.x Model / Migration drift 偵測
#     場景：有人改了 SQLAlchemy model 卻忘記產 migration → alembic current==head
#           但 DB schema 與 model 對不上，啟動後就會噴 UndefinedColumnError
#     注意：autogenerate 對 NOT NULL constraint 偵測常有假陽性，所以這裡只強調
#           會真的炸 query 的操作（新表 / 加減欄位 / 改欄位型別）。
info "檢查 Model / Migration drift（autogenerate diff）..."
DRIFT_LOG="${REPO_ROOT}/.dev-alembic-check.log"
_alembic check >"$DRIFT_LOG" 2>&1 || true

if grep -qi "no new upgrade operations detected" "$DRIFT_LOG"; then
    success "Model / Migration 一致"
elif grep -qi "new upgrade operations detected" "$DRIFT_LOG"; then
    # 統計各類操作數（過濾掉只動 NOT NULL 的假陽性）
    N_ADD_TABLE=$(grep -oE "'add_table'"   "$DRIFT_LOG" | wc -l | tr -d ' ')
    N_DROP_TABLE=$(grep -oE "'drop_table'" "$DRIFT_LOG" | wc -l | tr -d ' ')
    N_ADD_COL=$(grep -oE "'add_column'"    "$DRIFT_LOG" | wc -l | tr -d ' ')
    N_DROP_COL=$(grep -oE "'drop_column'"  "$DRIFT_LOG" | wc -l | tr -d ' ')
    N_ALTER_TYPE=$(grep -oE "'modify_type'" "$DRIFT_LOG" | wc -l | tr -d ' ')
    REAL_DRIFT=$(( N_ADD_TABLE + N_DROP_TABLE + N_ADD_COL + N_DROP_COL + N_ALTER_TYPE ))
    if (( REAL_DRIFT > 0 )); then
        warn "偵測到 ${REAL_DRIFT} 處 Model / Migration drift（會導致 UndefinedColumnError）："
        (( N_ADD_TABLE  > 0 )) && warn "    · 新增 table 缺 migration：${N_ADD_TABLE}"
        (( N_DROP_TABLE > 0 )) && warn "    · 移除 table 缺 migration：${N_DROP_TABLE}"
        (( N_ADD_COL    > 0 )) && warn "    · 新增 column 缺 migration：${N_ADD_COL}"
        (( N_DROP_COL   > 0 )) && warn "    · 移除 column 缺 migration：${N_DROP_COL}"
        (( N_ALTER_TYPE > 0 )) && warn "    · 變更 column type 缺 migration：${N_ALTER_TYPE}"
        # 印出真正的 table.column 名稱（過濾噪音）
        grep -oE "Table\('[a-z_]+'" "$DRIFT_LOG" | sort -u | head -10 | \
            sed "s/Table('/    ${C_YELLOW}·${C_RESET} table /; s/'$//"
        warn "→ 修法："
        warn "    1) uv run --project apps/api python -m alembic revision --autogenerate -m '<說明>'"
        warn "    2) 審視 apps/api/alembic/versions/ 下新檔案（刪除假陽性的 NOT NULL alter）"
        warn "    3) uv run --project apps/api python -m alembic upgrade head"
        warn "→ 完整 diff：${DRIFT_LOG}"
    else
        # 只有 NOT NULL 之類的假陽性
        N_NULL=$(grep -c "NOT NULL" "$DRIFT_LOG" 2>/dev/null || echo 0)
        info "alembic 偵測到 ${N_NULL} 處 NOT NULL constraint 差異（通常是 autogenerate 假陽性），略過"
    fi
else
    # alembic check 可能因 import 失敗 / 連不上 DB 而異常；不阻擋啟動
    info "alembic check 無法判定（可能版本不支援或匯入失敗），略過 → ${DRIFT_LOG}"
fi

# ──────────────────────────────────────────────────────────────────────────
# 6. 啟動 FastAPI 後端
# ──────────────────────────────────────────────────────────────────────────
step "7/8 啟動 FastAPI（port 8000）"

: > "$API_LOG"
(
    cd "${REPO_ROOT}/apps/api"
    # dev 一律 text 格式：若父 shell 不小心 export LOG_FORMAT=json（pydantic-settings
    # 中環境變數會壓過 .env），這裡強制覆寫，避免 console 變成 JSON 大水缸。
    # 想要 json log 請手動跑 `LOG_FORMAT=json uv run ...`。
    export LOG_FORMAT=text
    exec uv run --project "${REPO_ROOT}/apps/api" python -m uvicorn api:app \
        --host 0.0.0.0 \
        --port 8000 \
        --reload \
        --reload-dir src \
        --app-dir src \
        > >(_stream_log "api" "$API_LOG" "$C_BLUE") 2>&1
) &
API_PID=$!

info "等待 FastAPI /health 回應（最多 60 秒）..."
API_READY=0
for i in $(seq 1 60); do
    if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
        API_READY=1
        break
    fi
    if ! kill -0 "$API_PID" 2>/dev/null; then
        error "FastAPI 行程已退出，最後 40 行 log："
        tail -n 40 "$API_LOG" >&2
        exit 1
    fi
    sleep 1
done
if [[ $API_READY -eq 0 ]]; then
    error "FastAPI 60 秒內未回應 /health，最後 40 行 log："
    tail -n 40 "$API_LOG" >&2
    kill -TERM "$API_PID" 2>/dev/null || true
    exit 1
fi
success "FastAPI 已啟動 PID=${API_PID} → http://localhost:8000/docs"

# ──────────────────────────────────────────────────────────────────────────
# 7.x 啟動 Discord Bot（若已設定 DISCORD_BOT_TOKEN）
# ──────────────────────────────────────────────────────────────────────────
if [[ -n "${DISCORD_BOT_TOKEN:-}" ]]; then
    step "7.5/8 啟動 Discord Bot"
    : > "$DISCORD_LOG"
    (
        cd "${REPO_ROOT}/apps/api"
        export PYTHONPATH="${REPO_ROOT}/apps/api/src"
        exec uv run --project "${REPO_ROOT}/apps/api" python -m api.discord_worker \
            > >(_stream_log "discord" "$DISCORD_LOG" "$C_CYAN") 2>&1
    ) &
    DISCORD_PID=$!

    sleep 2
    if kill -0 "$DISCORD_PID" 2>/dev/null; then
        success "Discord Bot 已啟動 PID=${DISCORD_PID} → log: ${DISCORD_LOG}"
    else
        error "Discord Bot 啟動後立即退出，最後 40 行 log："
        tail -n 40 "$DISCORD_LOG" >&2
        exit 1
    fi
else
    info "DISCORD_BOT_TOKEN 未設定，略過 Discord Bot 啟動"
fi

# ──────────────────────────────────────────────────────────────────────────
# 7.y 啟動 Email Celery Worker
# ──────────────────────────────────────────────────────────────────────────
step "7.6/8 啟動 Email Worker（Celery email queue）"

: > "$EMAIL_WORKER_LOG"
(
    cd "${REPO_ROOT}/apps/api"
    export PYTHONPATH="${REPO_ROOT}/apps/api/src"
    export LOG_FORMAT=text  # 與 API 一致：dev 模式 text、prod 才 json
    exec uv run --project "${REPO_ROOT}/apps/api" python -m celery \
        -A api.core.celery_app.celery_app worker \
        --loglevel=info \
        --concurrency=1 \
        --queues=email \
        -n email-dev@%h \
        > >(_stream_log "email" "$EMAIL_WORKER_LOG" "$C_CYAN") 2>&1
) &
EMAIL_WORKER_PID=$!

sleep 3
if kill -0 "$EMAIL_WORKER_PID" 2>/dev/null; then
    success "Email Worker 已啟動 PID=${EMAIL_WORKER_PID} → log: ${EMAIL_WORKER_LOG}"
else
    error "Email Worker 啟動後立即退出，最後 60 行 log："
    tail -n 60 "$EMAIL_WORKER_LOG" >&2
    exit 1
fi

# ──────────────────────────────────────────────────────────────────────────
# 8. 啟動 Next.js 前端
# ──────────────────────────────────────────────────────────────────────────
step "8/8 啟動 Next.js（port 3000）"

WEB_DIR="${REPO_ROOT}/apps/web"

# 7.1 判斷是否需要 npm install
NEED_INSTALL=0
NEED_REASON=""
if [[ ! -d "${WEB_DIR}/node_modules" ]]; then
    NEED_INSTALL=1; NEED_REASON="node_modules 不存在"
elif [[ "${WEB_DIR}/package-lock.json" -nt "${WEB_DIR}/node_modules" ]]; then
    NEED_INSTALL=1; NEED_REASON="package-lock.json 比 node_modules 新"
elif [[ "${WEB_DIR}/package.json" -nt "${WEB_DIR}/node_modules" ]]; then
    NEED_INSTALL=1; NEED_REASON="package.json 比 node_modules 新"
fi

if [[ $NEED_INSTALL -eq 1 ]]; then
    info "需要 npm install（原因：${NEED_REASON}）"
    if ! (cd "${WEB_DIR}" && npm install --no-audit --no-fund); then
        warn "npm install 失敗，清理 node_modules / .next 後重試"
        rm -rf "${WEB_DIR}/node_modules" "${WEB_DIR}/.next" 2>/dev/null || true
        if ! (cd "${WEB_DIR}" && npm install --no-audit --no-fund); then
            error "npm install 仍然失敗，請檢查 npm error log"
            exit 1
        fi
        fix "已清理 node_modules / .next 並重新安裝"
    fi
fi

: > "$WEB_LOG"
(
    cd "${WEB_DIR}"
    # DEBUG 是後端 FastAPI 旗標；若繼承到此處會讓 @tailwindcss/postcss
    # 在每次 CSS rebuild 噴出 [Xms] 計時 log，故前端行程不繼承它
    unset DEBUG
    exec npm run dev > >(_stream_log "web" "$WEB_LOG" "$C_MAGENTA") 2>&1
) &
WEB_PID=$!

info "等待 Next.js port 3000 回應（最多 90 秒，首次編譯較慢）..."
WEB_READY=0
for i in $(seq 1 90); do
    if curl -fsS http://localhost:3000 >/dev/null 2>&1; then
        WEB_READY=1
        break
    fi
    if ! kill -0 "$WEB_PID" 2>/dev/null; then
        error "Next.js 行程已退出，最後 40 行 log："
        tail -n 40 "$WEB_LOG" >&2
        exit 1
    fi
    sleep 1
done
if [[ $WEB_READY -eq 1 ]]; then
    success "Next.js 已啟動 PID=${WEB_PID} → http://localhost:3000"
else
    # 行程還活著（編譯中）→ 警告但不中止
    warn "Next.js 90 秒內未回應，但行程仍存活（可能正在首次編譯）"
    warn "持續觀察：tail -f ${WEB_LOG}"
fi

# ──────────────────────────────────────────────────────────────────────────
# 完成
# ──────────────────────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START_TIME ))
printf '\n'
printf '  %sREADY%s  開發環境已就緒（耗時 %ss）\n' "$C_GREEN" "$C_RESET" "$ELAPSED"
printf '\n'
printf '  API Docs   http://localhost:8000/docs\n'
printf '  Web UI     http://localhost:3000\n'
printf '  Meili      %s\n' "${MEILI_URL_LOCAL:-http://localhost:7700}"
printf '  API Log    %s\n' "$API_LOG"
printf '  Email Log  %s\n' "$EMAIL_WORKER_LOG"
printf '  Web Log    %s\n' "$WEB_LOG"
[[ -n "$DISCORD_PID" ]] && printf '  Discord   %s\n' "$DISCORD_LOG"
printf '\n'
printf '  按 Ctrl+C 停止所有服務\n\n'

# 等待背景行程（保持腳本存活以接收 Ctrl+C）
if [[ -n "$DISCORD_PID" ]]; then
    wait "$API_PID" "$EMAIL_WORKER_PID" "$WEB_PID" "$DISCORD_PID"
else
    wait "$API_PID" "$EMAIL_WORKER_PID" "$WEB_PID"
fi
