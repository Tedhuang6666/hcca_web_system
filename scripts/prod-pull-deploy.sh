#!/usr/bin/env bash
# 一鍵拉取 + 部署（GHCR 預建映像版）。在 VPS 的 repo 目錄執行：
#   ./scripts/prod-pull-deploy.sh
#
# 流程：git pull → 設定檢查 → compose pull → 預部署 DB 備份 → blue-green 切流 → smoke test。
# 預設「不」啟動 celery-worker / celery-beat（重背景任務）；要一起開：
#   WITH_WORKERS=1 ./scripts/prod-pull-deploy.sh
#
# 可用環境變數覆寫：
#   ENV_FILE=.env.production COMPOSE_FILE=docker-compose.prod.pull.yml
#   WITH_WORKERS=1     # 連 celery-worker / celery-beat 一起起
#   SKIP_GIT=1         # 跳過 git pull（例如手動同步檔案時）
#   RELEASE_SHA=<sha>  # 指定已通過 CI 且已推送到 GHCR 的 commit（預設目前 HEAD）
#   DEPLOY_STRATEGY=inplace  # 暫時退回原地重建流程（不建議）
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

require_env_value() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "$value" || "$value" == *"CHANGE_ME"* || "$value" == *"your-"* ]]; then
    echo "❌ $env_file 的 $key 未設定為正式值" >&2
    exit 1
  fi
}

if [[ ! -f "$env_file" ]]; then
  echo "❌ 找不到部署設定檔：$env_file" >&2
  exit 1
fi

step "驗證正式環境設定"
for key in SECRET_KEY POSTGRES_PASSWORD REDIS_PASSWORD BACKUP_GPG_PASSPHRASE; do
  require_env_value "$key"
done
if ! grep -q '^TRUST_CLOUDFLARE_PROXY=true$' "$env_file"; then
  echo "❌ 正式環境必須啟用 TRUST_CLOUDFLARE_PROXY=true" >&2
  exit 1
fi
if grep -q '^CF_TRUSTED_PROXIES=\[\]$' "$env_file"; then
  echo "❌ 必須設定 Caddy Docker network 的 CF_TRUSTED_PROXIES CIDR" >&2
  exit 1
fi

if [[ "${SKIP_GIT:-0}" != "1" && -d .git ]]; then
  step "git pull"
  git pull --ff-only

  # SECURITY: 驗證 HEAD commit 的 GPG 簽章，防止未簽名的惡意 commit 被自動部署。
  # 若 commit 未簽名，預設發出警告但不中止（REQUIRE_GPG_VERIFY=1 可升為硬性要求）。
  # 若您的倉庫尚未啟用 commit signing，請參考 docs/OPERATIONS_GUIDE.md 設定。
  if [[ "${SKIP_GPG_VERIFY:-0}" != "1" ]]; then
    if git verify-commit HEAD 2>/dev/null; then
      echo "✓ GPG 簽章驗證通過"
    else
      echo "⚠️  WARNING: HEAD commit 無有效 GPG 簽章（未啟用 commit signing 或金鑰未受信任）"
      if [[ "${REQUIRE_GPG_VERIFY:-0}" == "1" ]]; then
        echo "❌ REQUIRE_GPG_VERIFY=1：簽章驗證失敗，中止部署"
        exit 1
      fi
    fi
  fi
fi

release_sha="${RELEASE_SHA:-$(git rev-parse HEAD)}"
if ! [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "❌ RELEASE_SHA 必須是完整 40 字元 commit SHA" >&2
  exit 1
fi

step "確認指定 commit 的不可變 GHCR 映像已就緒"
./scripts/wait-ghcr-image.sh "$release_sha"
export API_IMAGE="ghcr.io/tedhuang6666/hcca_web_system-api:${release_sha}"
export WEB_IMAGE="ghcr.io/tedhuang6666/hcca_web_system-web:${release_sha}"

step "docker compose pull（拉指定 commit 映像）"
"${compose[@]}" "${profiles[@]}" pull

# 每次 migration 前強制做邏輯備份；失敗即停止，避免不可逆 schema / data migration
# 在沒有可還原點時繼續部署。備份檔僅限 owner 讀取，請由既有離站備份程序同步保存。
step "啟動資料庫並建立 migration 前備份"
"${compose[@]}" up -d db
backup_dir="${PREDEPLOY_BACKUP_DIR:-backups/predeploy}"
mkdir -p "$backup_dir"
umask 077
backup_file="$backup_dir/predeploy-${release_sha}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
if ! "${compose[@]}" exec -T db sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip -c > "$backup_file"; then
  echo "❌ 預部署資料庫備份失敗，中止部署" >&2
  exit 1
fi
if [[ ! -s "$backup_file" ]] || ! gzip -t "$backup_file"; then
  echo "❌ 預部署資料庫備份無法驗證，中止部署" >&2
  exit 1
fi
echo "✓ 預部署備份完成：$backup_file"

if [[ "${DEPLOY_STRATEGY:-bluegreen}" == "bluegreen" ]]; then
  step "啟動 blue-green 零停機部署"
  API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" WITH_WORKERS="${WITH_WORKERS:-0}" \
    ENV_FILE="$env_file" COMPOSE_FILE="docker-compose.bluegreen.yml" \
    ./scripts/zero-downtime-deploy.sh "${DEPLOY_SLOT:-auto}"

  # 流量切換成功後，在不影響 HTTP 的情況下更新專責寄信 worker，
  # 再停止舊的單槽 API/Web/一般 worker。blue-green 的 beat 若啟用，已由上一步管理。
  legacy_compose=(docker compose --env-file "$env_file" -f "$compose_file")
  "${legacy_compose[@]}" --profile email up -d email-worker 2>/dev/null || true
  "${legacy_compose[@]}" stop api web celery-worker 2>/dev/null || true
  exit 0
fi

# 套用資料庫 migration（alembic upgrade head）必須在起 api/web 前先跑，否則新映像會對
# 舊 schema 查詢而整路由 500（例：column elections.slug does not exist）。
# migrate 在 migrate profile，預設 up 不啟動；其 depends_on db: service_healthy，
# 故 run 會自動把 db 拉起並等健康後才執行。SKIP_MIGRATE=1 可在確定無 schema 變動時略過。
if [[ "${SKIP_MIGRATE:-0}" != "1" ]]; then
  step "套用資料庫 migration（alembic upgrade head）"
  "${compose[@]}" --profile migrate run --rm migrate
fi

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
