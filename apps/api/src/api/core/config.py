"""應用程式設定 - 使用 Pydantic Settings 管理環境變數"""

import warnings

from pydantic import Field, PostgresDsn, RedisDsn, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_SECRET = "CHANGE_ME_IN_PRODUCTION_USE_256_BIT_KEY"


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

    # --- 資料庫設定 ---
    DATABASE_URL: PostgresDsn = Field(
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

    # --- 健康檢查 ---
    HEALTHCHECK_TIMEOUT_SECONDS: float = Field(default=2.0, gt=0)
    SLOW_REQUEST_THRESHOLD_MS: int = Field(default=1000, ge=1)

    # --- Redis 設定 ---
    REDIS_URL: RedisDsn = Field(default="redis://localhost:6379/0")
    REDIS_MAX_CONNECTIONS: int = Field(default=50, ge=1)
    REDIS_SOCKET_TIMEOUT: float = Field(default=2.0, gt=0)
    REDIS_HEALTH_CHECK_INTERVAL: int = Field(default=30, ge=1)

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

    # --- Search / Meilisearch ---
    MEILISEARCH_URL: str = Field(default="")
    MEILISEARCH_API_KEY: str = Field(default="")
    MEILISEARCH_INDEX_PREFIX: str = Field(default="hcca")

    # --- Web Push ---
    VAPID_PUBLIC_KEY: str = Field(default="")
    VAPID_PRIVATE_KEY: str = Field(default="")
    VAPID_SUBJECT: str = Field(default="mailto:admin@example.com")

    # --- Passkeys / WebAuthn ---
    PASSKEY_RP_ID: str = Field(default="localhost")
    PASSKEY_RP_NAME: str = Field(default="HCCA 校園自治整合平台")
    PASSKEY_ORIGIN: str = Field(default="http://localhost:3000")

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
    SECRET_KEY: str = Field(default=_DEFAULT_SECRET)
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
    LOGIN_ALLOWED_EMAIL_DOMAINS: list[str] = Field(
        default_factory=lambda: ["hchs.hc.edu.tw"],
        description="允許一般使用者登入的 Email 網域；不含 @",
    )
    LOGIN_EMAIL_ALLOWLIST: list[str] = Field(
        default_factory=list,
        description="額外允許登入的完整 Email，適合管理員 Gmail 例外",
    )
    LOGIN_ALLOW_EXTERNAL_USERS: bool = Field(
        default=True,
        description=(
            "允許任何 Google 帳號登入；校外/外校帳號登入後不會被分配職位，"
            "僅有公開頁等級的檢視權限與陳情送件功能。"
            "設為 False 則恢復僅限 LOGIN_ALLOWED_EMAIL_DOMAINS / allowlist。"
        ),
    )

    # --- Email / SMTP 設定 ---
    MAIL_USERNAME: str = Field(default="")
    MAIL_PASSWORD: str = Field(default="")
    MAIL_FROM: str = Field(default="noreply@campus.edu")
    MAIL_FROM_NAME: str = Field(default="校園自治整合平台")
    MAIL_PORT: int = Field(default=587)
    MAIL_SERVER: str = Field(default="smtp.gmail.com")
    MAIL_STARTTLS: bool = Field(default=True)
    MAIL_SSL_TLS: bool = Field(default=False)
    # 前端基底 URL — email 內絕對連結用（退訂連結、CTA、通知偏好頁）
    FRONTEND_BASE_URL: str = Field(default="http://localhost:3000")
    # 每位使用者每日透過平台寄送 email 的「人次」上限（防濫用）
    EMAIL_DAILY_QUOTA_PER_USER: int = Field(default=500)

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

    # --- 瀏覽器安全標頭 ---
    SECURITY_HEADERS_ENABLED: bool = True
    SECURITY_HSTS_MAX_AGE_SECONDS: int = 31_536_000
    SECURITY_CSP: str = (
        "default-src 'self'; "
        "img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self'"
    )

    # --- LINE Bot 設定 ---
    LINE_CHANNEL_SECRET: str = Field(default="")
    LINE_CHANNEL_ACCESS_TOKEN: str = Field(default="")

    # --- Discord Bot / OAuth 設定 ---
    DISCORD_CLIENT_ID: str = Field(default="")
    DISCORD_CLIENT_SECRET: str = Field(default="")
    DISCORD_BOT_TOKEN: str = Field(default="")
    DISCORD_REDIRECT_URI: str = Field(default="http://localhost:8000/discord/callback")
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

    # --- 系統設定 / .env 編輯頁（高危：預設關閉）---
    # 啟用後超管可在 /admin/settings 檢視與編輯設定；明文密鑰與儲存須 MFA 再驗證。
    ENABLE_ENV_EDITOR: bool = Field(default=False)

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_set(cls, v: str) -> str:
        if v == _DEFAULT_SECRET:
            import os

            if os.getenv("ENVIRONMENT", "development").lower() in {"prod", "production"}:
                raise ValueError("生產環境必須設定非預設的 SECRET_KEY")
            warnings.warn("SECRET_KEY 使用預設值，僅允許本機開發環境使用。", stacklevel=2)
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

    @model_validator(mode="after")
    def production_security_must_be_explicit(self) -> "Settings":
        is_prod = self.ENVIRONMENT.lower() in {"prod", "production"}
        if is_prod and self.SECRET_KEY == _DEFAULT_SECRET:
            raise ValueError("生產環境必須設定強 SECRET_KEY，不能使用預設值")
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
        return self


settings = Settings()
