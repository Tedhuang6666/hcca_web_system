"""應用程式設定 - 使用 Pydantic Settings 管理環境變數"""

import warnings
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_FALLBACK_SIGNING_KEY = "CHANGE_ME_IN_PRODUCTION_USE_256_BIT_KEY"

# 已知不安全金鑰清單：dev/CI 環境使用的固定字串，生產環境必須拒絕。
_KNOWN_INSECURE_KEYS: frozenset[str] = frozenset({
    _FALLBACK_SIGNING_KEY,
    "ci-test-secret-key-32-characters-min",
    "test-secret-key",
    "secret",
    "dev",
})

# 視為「本機預設」的 host；這些值代表尚未為部署環境設定，可被部署網址自動覆寫。
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})


def _is_local_url(value: str) -> bool:
    """判斷 URL（或裸 host）是否為本機預設值。空字串視為未設定 → True。"""
    if not value:
        return True
    host = urlsplit(value).hostname or value
    return host in _LOCAL_HOSTS


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # 依序搜尋：apps/api/.env → 工作區根目錄 .env（monorepo 支援）
        env_file=[".env", "../../.env"],
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- 應用程式基本設定 ---
    APP_NAME: str = "校園自治整合平台"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    ENABLE_API_DOCS: bool = False
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]
    ALLOWED_HOSTS: list[str] = ["localhost", "127.0.0.1", "api", "test"]
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    ACCESS_LOG_ENABLED: bool = True

    # --- 資料庫設定 ---
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://postgres:password@localhost:5432/campus_platform"
    )
    DATABASE_URL_SYNC: str = Field(
        default="postgresql+psycopg2://postgres:password@localhost:5432/campus_platform"
    )
    SQL_ECHO: bool = False
    DB_POOL_SIZE: int = Field(default=10, ge=1)
    DB_MAX_OVERFLOW: int = Field(default=20, ge=0)
    DB_POOL_TIMEOUT_SECONDS: int = Field(default=30, ge=1)
    DB_POOL_RECYCLE_SECONDS: int = Field(default=1800, ge=60)
    # 走 PgBouncer（transaction pooling）時設 true：app 端改用 NullPool 並關閉
    # asyncpg server-side prepared statement cache，避免 "prepared statement does not exist"。
    DB_USE_PGBOUNCER: bool = Field(default=False)

    # --- 健康檢查 ---
    HEALTHCHECK_TIMEOUT_SECONDS: float = Field(default=2.0, gt=0)
    # 啟動時等待 DB / Redis 就緒的總上限（退避重試）；逾時才 app exit。
    STARTUP_READINESS_MAX_WAIT_SECONDS: float = Field(default=60.0, ge=0)
    SLOW_REQUEST_THRESHOLD_MS: int = Field(default=1000, ge=1)

    # --- Redis 設定 ---
    REDIS_URL: str = Field(default="redis://localhost:6379/0")
    REDIS_MAX_CONNECTIONS: int = Field(default=50, ge=1)
    REDIS_SOCKET_TIMEOUT: float = Field(default=2.0, gt=0)
    REDIS_HEALTH_CHECK_INTERVAL: int = Field(default=30, ge=1)

    # --- Celery failure retention / DLQ ---
    CELERY_INSPECT_TIMEOUT_SECONDS: float = Field(default=0.25, gt=0)
    CELERY_DLQ_ENABLED: bool = True
    CELERY_DLQ_REDIS_KEY: str = "celery:dead_letter:v1"
    CELERY_DLQ_MAX_ITEMS: int = Field(default=1000, ge=1)

    # --- 自動錯誤報告 ---
    ERROR_REPORT_EMAIL_ENABLED: bool = Field(default=True)
    ERROR_REPORT_INTERVAL_SECONDS: int = Field(default=300, ge=60)
    ERROR_REPORT_WINDOW_SECONDS: int = Field(default=900, ge=60)
    ERROR_REPORT_MAX_ITEMS: int = Field(default=20, ge=1)
    ERROR_REPORT_REDIS_KEY: str = "error_report:events:v1"
    ERROR_REPORT_STATE_KEY: str = "error_report:last_sent_at:v1"
    ERROR_REPORT_RETENTION_ITEMS: int = Field(default=1000, ge=1)

    # --- Cloudflare / 信任代理 ---
    # 啟用時，從 CF-Connecting-IP 取真實 client IP（僅信任 socket peer ∈ CF 官方 CIDR）
    TRUST_CLOUDFLARE_PROXY: bool = Field(default=False)
    # 額外信任的 proxy CIDR；留空時內建 Cloudflare 官方公開 IP 段
    CF_TRUSTED_PROXIES: list[str] = Field(default_factory=list)

    # --- WebSocket 連線控制 ---
    WS_GLOBAL_MAX_CONNECTIONS: int = Field(default=2000, ge=1)
    WS_PER_IP_MAX_CONNECTIONS: int = Field(default=20, ge=1)
    WS_PER_ROOM_MAX_CONNECTIONS: int = Field(default=300, ge=1)
    WS_HEARTBEAT_INTERVAL_SECONDS: int = Field(default=30, ge=5)
    WS_HEARTBEAT_TIMEOUT_SECONDS: int = Field(default=90, ge=10)

    # --- Payload 大小限制（middleware 層）---
    PAYLOAD_MAX_BYTES_JSON: int = Field(default=2_097_152, ge=1024)  # 2 MiB
    PAYLOAD_MAX_BYTES_MULTIPART: int = Field(default=26_214_400, ge=1024)  # 25 MiB

    # --- Sentry 錯誤追蹤 ---
    SENTRY_DSN: str = Field(default="")
    SENTRY_TRACES_SAMPLE_RATE: float = Field(default=0.1, ge=0.0, le=1.0)
    SENTRY_PROFILES_SAMPLE_RATE: float = Field(default=0.0, ge=0.0, le=1.0)

    # --- PostHog 產品分析 ---
    POSTHOG_API_KEY: str = Field(default="")
    POSTHOG_HOST: str = Field(default="https://us.i.posthog.com")

    # --- Search / Meilisearch ---
    MEILISEARCH_URL: str = Field(default="")
    MEILISEARCH_API_KEY: str = Field(default="")
    MEILISEARCH_INDEX_PREFIX: str = Field(default="hcca")

    # --- Web Push ---
    VAPID_PUBLIC_KEY: str = Field(default="")
    VAPID_PRIVATE_KEY: str = Field(default="")
    VAPID_SUBJECT: str = Field(default="mailto:admin@example.com")

    # --- WebSocket pub/sub backend ---
    # redis：跨 worker / 跨節點廣播（生產建議）；memory：單一進程（測試 / 開發單 worker）
    WS_PUBSUB_BACKEND: str = Field(default="redis")

    # --- Load Shedding（管理員優先）---
    LOAD_SHED_ENABLED: bool = Field(default=True)
    LOAD_SHED_MAX_ACTIVE_REQUESTS: int = Field(default=100, ge=1)
    LOAD_SHED_5XX_RATIO_THRESHOLD: float = Field(default=0.10, ge=0.0, le=1.0)
    LOAD_SHED_DB_POOL_THRESHOLD: float = Field(default=0.85, ge=0.0, le=1.0)
    LOAD_SHED_RETRY_AFTER_BASE_SECONDS: int = Field(default=5, ge=1)

    # --- 模組斷路器（per-module 自動維護）---
    MODULE_CIRCUIT_ENABLED: bool = Field(default=True)
    MODULE_CIRCUIT_5XX_THRESHOLD: int = Field(default=10, ge=1)
    MODULE_CIRCUIT_WINDOW_SECONDS: int = Field(default=60, ge=1)
    MODULE_CIRCUIT_COOLDOWN_SECONDS: int = Field(default=120, ge=1)

    # --- 模組斷路器：升級門檻（依錯誤嚴重度）---
    # 1h 滾動窗口內跳閘次數達門檻 → 升級為 manual 維護（不自動恢復）
    MODULE_TRIP_THRESHOLD_CRITICAL: int = Field(default=3, ge=1)
    MODULE_TRIP_THRESHOLD_HIGH: int = Field(default=5, ge=1)
    MODULE_TRIP_THRESHOLD_NORMAL: int = Field(default=7, ge=1)
    MODULE_TRIP_ESCALATION_WINDOW_SECONDS: int = Field(default=3600, ge=60)
    MODULE_CIRCUIT_COOLDOWN_BASE_SECONDS: int = Field(default=60, ge=1)
    MODULE_CIRCUIT_COOLDOWN_MAX_SECONDS: int = Field(default=1800, ge=1)
    # half-open 自動探測排程間隔（Celery beat）
    MODULE_PROBE_INTERVAL_SECONDS: int = Field(default=30, ge=10)
    # 探測呼叫的內部 base URL（默認 self loopback）
    MODULE_PROBE_BASE_URL: str = Field(default="http://127.0.0.1:8000")
    # 跳閘通知接收 Discord channel id（留空則不發 Discord）
    MODULE_ALERT_DISCORD_CHANNEL_ID: str = Field(default="")

    # --- JWT 設定 ---
    SECRET_KEY: str = Field(default=_FALLBACK_SIGNING_KEY)
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ACCESS_TOKEN_COOKIE_NAME: str = "hcca_access_token"
    REFRESH_TOKEN_COOKIE_NAME: str = "hcca_refresh_token"
    SESSION_COOKIE_NAME: str = "hcca_session"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    # --- Google OAuth2 設定 ---
    GOOGLE_CLIENT_ID: str = Field(default="")
    GOOGLE_CLIENT_SECRET: str = Field(default="")
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/auth/google/callback"
    GOOGLE_CALENDAR_REDIRECT_URI: str = "http://localhost:8000/calendar/google/callback"
    GOOGLE_TASKS_REDIRECT_URI: str = "http://localhost:8000/user/google-tasks/callback"
    LOGIN_ALLOWED_EMAIL_DOMAINS: list[str] = Field(
        default_factory=lambda: ["hchs.hc.edu.tw"],
        description="允許一般使用者登入的 Email 網域；不含 @",
    )
    LOGIN_EMAIL_ALLOWLIST: list[str] = Field(
        default_factory=list,
        description="額外允許登入的完整 Email，適合管理員 Gmail 例外",
    )
    LOGIN_ALLOW_EXTERNAL_USERS: bool = Field(
        default=False,
        description=(
            "允許任何 Google 帳號登入；校外/外校帳號登入後不會被分配職位，"
            "僅有公開頁等級的檢視權限與陳情送件功能。"
            "設為 False 則恢復僅限 LOGIN_ALLOWED_EMAIL_DOMAINS / allowlist。"
        ),
    )

    # --- Email / Resend 設定 ---
    RESEND_API_KEY: str = Field(default="")
    MAIL_FROM: str = Field(default="noreply@hct.works")
    MAIL_FROM_NAME: str = Field(default="新竹高中班聯會 HCCA")
    # 部署網址單一來源 — 整個系統對外的基底 URL（前端入口；/api、/ws、OAuth 回呼皆同源轉發）。
    # 只要在此填入正式網址（例如 https://hcca40.hct.works），derive_public_urls 會自動推導
    # ALLOWED_ORIGINS / ALLOWED_HOSTS / 各 OAuth 回呼等仍停留在 localhost 預設的欄位，
    # 不需逐一手動填寫。email 內的絕對連結（退訂、CTA、通知偏好頁）亦以此為基底。
    FRONTEND_BASE_URL: str = Field(default="http://localhost:3000")
    # Email 客戶端載入使用者上傳檔案（/uploads/...）時需要可公開存取的 API base。
    API_PUBLIC_BASE_URL: str = Field(default="http://localhost:8000")
    # Email 內前端連結使用的公開 base；避免本機開發網址出現在寄出的信件中。
    EMAIL_LINK_BASE_URL: str = Field(default="https://hcca40.hct.works")
    # Email header 會徽圖片 URL；可填外部圖床或正式站 public 圖片的完整網址。
    # 若填外部 host，須同步把該 host 加進 proxy.ts 與下方 SECURITY_CSP 的 img-src，
    # 否則寄信頁預覽 iframe 會被 CSP 擋下。
    EMAIL_BRAND_LOGO_URL: str = Field(
        default="https://hcca.buckets.hct.works/images/hcca-emblem.png"
    )
    # 每位使用者每日透過平台寄送 email 的「人次」上限（防濫用）
    EMAIL_DAILY_QUOTA_PER_USER: int = Field(default=500)
    EMAIL_ATTACHMENT_INLINE_MAX_BYTES: int = Field(default=8 * 1024 * 1024)
    EMAIL_ATTACHMENT_LINK_EXPIRES_SECONDS: int = Field(default=7 * 24 * 3600)
    EMAIL_SEND_BATCH_SIZE: int = Field(default=100)
    RESEND_WEBHOOK_SECRET: str = Field(default="")

    # --- 超級管理員 ---
    OWNER_EMAILS: list[str] = Field(
        default_factory=list,
        description="最高擁有者帳號，不可由後台停用或降級；同時可作為登入 allowlist",
    )
    # 生產環境禁用自動授予，改用 API + IP 白名單
    SUPERUSER_EMAILS: list[str] = Field(default_factory=list)
    ADMIN_IP_WHITELIST: list[str] = Field(
        default_factory=list,
        description="允許超級管理員登入的 IP 位址（若設定，登入 IP 必須在此清單中）",
    )
    REQUIRE_2FA_FOR_SUPERUSER: bool = Field(
        default=False,
        description="若啟用，超級管理員登入需要 2FA（目前實驗性功能）",
    )
    MFA_SECRET_ENCRYPTION_KEY: str = Field(
        default="",
        description="MFA secret 欄位加密用 key；未設定時由 SECRET_KEY 派生",
    )
    MFA_CHALLENGE_EXPIRE_MINUTES: int = Field(
        default=5,
        description="OAuth 登入完成後 MFA challenge token 有效分鐘數",
    )

    # --- 簡易 Rate Limit ---
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = 120
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    # 自己人 IP 白名單（逗號分隔字串或 JSON array，支援 CIDR，例如 1.2.3.4,127.0.0.1,10.0.0.0/8）。
    # 命中者豁免 rate limit 與 IP 黑名單（含 WAF autoblock 後的封鎖），避免管理者 / CI /
    # 家用固定 IP 被自家防護鎖在門外。仍受 WAF 單次特徵攔截，但不會被 autoblock 計數。
    RATE_LIMIT_TRUSTED_IPS: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        description="逗號分隔的信任 IP / CIDR；豁免 rate limit 與 IP 黑名單",
    )

    # --- Idempotency ---
    IDEMPOTENCY_ENABLED: bool = True
    IDEMPOTENCY_TTL_SECONDS: int = Field(default=86_400, ge=60)
    IDEMPOTENCY_LOCK_TTL_SECONDS: int = Field(default=30, ge=1)
    IDEMPOTENCY_METHODS: set[str] = Field(default_factory=lambda: {"POST", "PUT", "PATCH"})

    # --- 瀏覽器安全標頭 ---
    SECURITY_HEADERS_ENABLED: bool = True
    SECURITY_HSTS_MAX_AGE_SECONDS: int = 31_536_000
    # 此 CSP 套在 API（FastAPI）回應上：JSON API 與 /uploads 靜態檔。
    # script-src 不含 'unsafe-inline'——API 不需行內腳本，移除後可大幅降低
    # 同源 /uploads 若被上傳惡意 HTML 時的 XSS 風險。
    # 前端 HTML 頁面的 CSP 由 Next.js proxy.ts 以 per-request nonce 另行套用。
    SECURITY_CSP: str = (
        "default-src 'self'; "
        "img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://hcca.buckets.hct.works; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self'"
    )

    # --- WAF（注入特徵偵測）---
    # 在請求進到 router 前掃描 URL / query / 部分 header 的攻擊特徵
    # （路徑穿越、SQLi/XSS、${jndi:}、null byte、掃描器探測等）。
    WAF_ENABLED: bool = True
    # False = detect-only：只記 log 不攔截（剛上線想觀察誤判時用）。
    WAF_BLOCK_MODE: bool = True
    # 中信心規則（SQLi / XSS 字串特徵，較可能誤判使用者輸入）是否一併攔截；
    # 高信心規則（掃描器探測 / 路徑穿越 / null byte / jndi）永遠攔截。
    WAF_BLOCK_MEDIUM: bool = True
    # 短時間內多次命中高信心規則的 IP，自動丟進既有 ip_blocklist。
    WAF_AUTOBLOCK_ENABLED: bool = True
    WAF_AUTOBLOCK_THRESHOLD: int = Field(default=8, ge=1)
    WAF_AUTOBLOCK_WINDOW_SECONDS: int = Field(default=300, ge=10)
    WAF_AUTOBLOCK_TTL_SECONDS: int = Field(default=3600, ge=60)
    # 整條 URL（path + query）長度上限，防超長 URL 灌爆 / 規避。
    WAF_MAX_URL_LENGTH: int = Field(default=8192, ge=256)
    # 是否對 application/json POST body 掃描高信心規則（JNDI / 路徑穿越 / null byte）。
    # 僅讀前 64 KB，不影響 streaming 端點。預設關閉（opt-in）。
    WAF_SCAN_JSON_BODY: bool = False
    # 主動弱掃繞過 token：請求帶 `X-Security-Scan: <token>` 時完全繞過 WAF / rate limit /
    # IP 黑名單，供 Nuclei 等掃描器對自家站台施測。須夠長（>= 16 字元）；未設定 / 過短時
    # header 一律無效（避免空 token 漏洞）。比對採 constant-time。
    SECURITY_SCAN_BYPASS_TOKEN: str = Field(
        default="",
        description="X-Security-Scan header 的繞過 token；空字串或少於 16 字元代表停用",
    )

    # --- LINE Bot 設定 ---
    LINE_CHANNEL_SECRET: str = Field(default="")
    LINE_CHANNEL_ACCESS_TOKEN: str = Field(default="")

    # --- Discord Bot / OAuth 設定 ---
    DISCORD_CLIENT_ID: str = Field(default="")
    DISCORD_CLIENT_SECRET: str = Field(default="")
    DISCORD_REDIRECT_URI: str = Field(default="http://localhost:8000/discord/callback")
    DISCORD_LOGIN_REDIRECT_URI: str = Field(default="http://localhost:8000/auth/discord/callback")
    DISCORD_GUILD_ID: str = Field(default="")
    DISCORD_COMMAND_SYNC_GUILD_ID: str = Field(default="")

    # --- 附件儲存後端 ---
    STORAGE_BACKEND: str = Field(
        default="local",
        description="附件儲存後端：local（本地）或 s3（AWS S3 / MinIO）",
    )
    STORAGE_LOCAL_DIR: str = Field(default="uploads")
    S3_BUCKET: str = Field(default="")
    S3_REGION: str = Field(default="ap-northeast-1")

    # --- 資料庫備份 ---
    DB_BACKUP_ENABLED: bool = Field(default=False)
    DB_BACKUP_DIR: str = Field(
        default="backups",
        description="本地備份輸出目錄；若搭配 STORAGE_BACKEND=s3 則同步上傳",
    )
    DB_BACKUP_RETENTION_DAYS: int = Field(default=7)

    # --- 異地備份 ---
    # 對應 docs/DR_OBJECTIVES.md。設定後備份檔會 gpg 加密 + 上傳到指定異地 bucket。
    BACKUP_GPG_PASSPHRASE: str = Field(
        default="",
        description="GPG 對稱加密密碼。未設定時備份不加密（僅開發允許）",
    )
    BACKUP_S3_BUCKET: str = Field(
        default="",
        description="異地備份 S3 bucket 名稱（與主機房不同 region）",
    )
    BACKUP_S3_REGION: str = Field(
        default="ap-northeast-1",
        description="異地備份 bucket region；建議與 S3_REGION 不同 region",
    )
    BACKUP_S3_PREFIX: str = Field(
        default="postgres",
        description="S3 key prefix；可包含環境名稱以隔離 dev/prod",
    )
    BACKUP_VERIFY_SHA256: bool = Field(
        default=True,
        description="上傳前計算 sha256 並寫入 BackupRecord，還原時驗證",
    )

    # --- 欄位級加密 ---
    # 用於敏感欄位（MFA secret、API key 明文 mirror、第三方 token）。
    # 支援多 key（new first、舊 key 允許解密）以平滑輪替。
    # 格式：comma-separated Fernet base64 keys，例如：
    #   FIELD_ENCRYPTION_KEYS="<new_key_base64>,<old_key_base64>"
    FIELD_ENCRYPTION_KEYS: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        description="Fernet keys list（new first）。未設定時欄位加密功能停用",
    )

    # --- 系統設定 / .env 編輯頁（高危：預設關閉）---
    # 啟用後超管可在 /admin/settings 檢視與編輯設定；明文密鑰與儲存須 MFA 再驗證。
    ENABLE_ENV_EDITOR: bool = Field(default=False)

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_set(cls, v: str) -> str:
        import os

        is_prod = os.getenv("ENVIRONMENT", "development").lower() in {"prod", "production"}
        if v in _KNOWN_INSECURE_KEYS:
            if is_prod:
                raise ValueError(
                    "生產環境禁止使用已知不安全的 SECRET_KEY（dev/CI 固定字串），"
                    "請使用 openssl rand -hex 32 產生專屬金鑰。"
                )
            warnings.warn("SECRET_KEY 使用已知不安全值，僅允許本機開發/CI 環境。", stacklevel=2)
        elif len(v) < 32:
            if is_prod:
                raise ValueError("生產環境 SECRET_KEY 長度必須 ≥ 32 字元")
            warnings.warn("SECRET_KEY 長度過短，建議使用 256-bit（64 hex chars）。", stacklevel=2)
        return v

    @field_validator("DATABASE_URL")
    @classmethod
    def database_url_must_be_postgres(cls, v: str) -> str:
        scheme = urlsplit(v).scheme.lower()
        if not scheme.startswith("postgres"):
            raise ValueError("DATABASE_URL 必須使用 postgresql:// 或 postgresql+asyncpg:// 協定")
        return v

    @field_validator("REDIS_URL")
    @classmethod
    def redis_url_must_be_redis(cls, v: str) -> str:
        scheme = urlsplit(v).scheme.lower()
        if scheme not in {"redis", "rediss", "redis+sentinel"}:
            raise ValueError("REDIS_URL 必須使用 redis:// 協定")
        return v

    @field_validator("COOKIE_SAMESITE")
    @classmethod
    def cookie_samesite_must_be_valid(cls, v: str) -> str:
        normalized = v.lower()
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("COOKIE_SAMESITE 必須是 lax、strict 或 none")
        return normalized

    @field_validator(
        "LOGIN_ALLOWED_EMAIL_DOMAINS",
        "LOGIN_EMAIL_ALLOWLIST",
        "OWNER_EMAILS",
        "SUPERUSER_EMAILS",
    )
    @classmethod
    def normalize_email_settings(cls, values: list[str]) -> list[str]:
        return [value.strip().lower().lstrip("@") for value in values if value.strip()]

    @field_validator("FIELD_ENCRYPTION_KEYS", mode="before")
    @classmethod
    def parse_field_encryption_keys(cls, value: object) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                import json

                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = [item.strip() for item in raw.strip("[]").split(",") if item.strip()]
                if not isinstance(parsed, list):
                    raise ValueError("FIELD_ENCRYPTION_KEYS 必須是 JSON array 或逗號分隔字串")
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in raw.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        raise ValueError("FIELD_ENCRYPTION_KEYS 必須是 JSON array 或逗號分隔字串")

    @field_validator("RATE_LIMIT_TRUSTED_IPS", mode="before")
    @classmethod
    def parse_trusted_ips(cls, value: object) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                import json

                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = [item.strip() for item in raw.strip("[]").split(",") if item.strip()]
                if not isinstance(parsed, list):
                    raise ValueError("RATE_LIMIT_TRUSTED_IPS 必須是 JSON array 或逗號分隔字串")
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in raw.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        raise ValueError("RATE_LIMIT_TRUSTED_IPS 必須是 JSON array 或逗號分隔字串")

    @model_validator(mode="after")
    def derive_public_urls(self) -> "Settings":
        """以 FRONTEND_BASE_URL 為單一來源，自動套用部署網址到尚未設定的 URL 家族。

        規則：只有當 FRONTEND_BASE_URL 是真正對外網域（非 localhost）時才推導，
        且僅覆寫仍停留在本機預設的欄位——使用者已明確指向其他網域的設定不會被動到。
        ALLOWED_ORIGINS / ALLOWED_HOSTS 採「補進」而非覆寫，保留 localhost 以利本機開發。
        """
        base = self.FRONTEND_BASE_URL.rstrip("/")
        if _is_local_url(base):
            return self

        parts = urlsplit(base)
        origin = f"{parts.scheme}://{parts.netloc}"
        host = parts.hostname or ""

        if origin not in self.ALLOWED_ORIGINS:
            self.ALLOWED_ORIGINS = [origin, *self.ALLOWED_ORIGINS]
        if host and host not in self.ALLOWED_HOSTS:
            self.ALLOWED_HOSTS = [host, *self.ALLOWED_HOSTS]

        if _is_local_url(self.GOOGLE_REDIRECT_URI):
            self.GOOGLE_REDIRECT_URI = f"{origin}/auth/google/callback"
        if _is_local_url(self.GOOGLE_CALENDAR_REDIRECT_URI):
            self.GOOGLE_CALENDAR_REDIRECT_URI = f"{origin}/calendar/google/callback"
        if _is_local_url(self.GOOGLE_TASKS_REDIRECT_URI):
            self.GOOGLE_TASKS_REDIRECT_URI = f"{origin}/user/google-tasks/callback"
        if _is_local_url(self.DISCORD_REDIRECT_URI):
            self.DISCORD_REDIRECT_URI = f"{origin}/discord/callback"
        if _is_local_url(self.DISCORD_LOGIN_REDIRECT_URI):
            self.DISCORD_LOGIN_REDIRECT_URI = f"{origin}/auth/discord/callback"
        if _is_local_url(self.API_PUBLIC_BASE_URL):
            self.API_PUBLIC_BASE_URL = origin

        return self

    @model_validator(mode="after")
    def production_security_must_be_explicit(self) -> "Settings":
        is_prod = self.ENVIRONMENT.lower() in {"prod", "production"}
        if is_prod and self.SECRET_KEY in _KNOWN_INSECURE_KEYS:
            raise ValueError("生產環境必須設定強 SECRET_KEY，不能使用已知不安全值（dev/CI 固定字串）")
        if is_prod and self.DEBUG:
            raise ValueError("生產環境不可啟用 DEBUG")
        if is_prod and self.ENABLE_API_DOCS:
            raise ValueError("生產環境不可公開 API 文件；請關閉 ENABLE_API_DOCS")
        if is_prod and self.SUPERUSER_EMAILS:
            raise ValueError("生產環境不可使用 SUPERUSER_EMAILS 自動繞過 RBAC")
        if is_prod and not self.COOKIE_SECURE:
            raise ValueError("生產環境必須啟用 COOKIE_SECURE")
        if "*" in self.ALLOWED_ORIGINS:
            raise ValueError("ALLOWED_ORIGINS 不可包含 '*'；請明確列出允許來源")
        if is_prod and "*" in self.ALLOWED_HOSTS:
            raise ValueError("生產環境 ALLOWED_HOSTS 不可包含 '*'；請明確列出允許 Host")
        if is_prod and self.VAPID_PRIVATE_KEY and len(self.VAPID_PRIVATE_KEY) > 20:
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "VAPID_PRIVATE_KEY 以明文存在環境變數中；建議改用 Secrets Manager 或加密 vault 管理，"
                "避免透過 /admin/settings 或 env dump 洩漏此金鑰（洩漏後可偽造推播通知給所有使用者）"
            )
        return self


settings = Settings()
