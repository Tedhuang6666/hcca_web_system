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
    ALLOWED_HOSTS: list[str] = ["localhost", "127.0.0.1", "api"]

    # --- 資料庫設定 ---
    DATABASE_URL: PostgresDsn = Field(
        default="postgresql+asyncpg://postgres:password@localhost:5432/campus_platform"
    )
    DATABASE_URL_SYNC: str = Field(
        default="postgresql+psycopg2://postgres:password@localhost:5432/campus_platform"
    )

    # --- Redis 設定 ---
    REDIS_URL: RedisDsn = Field(default="redis://localhost:6379/0")

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

    # --- Email / SMTP 設定 ---
    MAIL_USERNAME: str = Field(default="")
    MAIL_PASSWORD: str = Field(default="")
    MAIL_FROM: str = Field(default="noreply@campus.edu")
    MAIL_FROM_NAME: str = Field(default="校園自治整合平台")
    MAIL_PORT: int = Field(default=587)
    MAIL_SERVER: str = Field(default="smtp.gmail.com")
    MAIL_STARTTLS: bool = Field(default=True)
    MAIL_SSL_TLS: bool = Field(default=False)

    # --- 超級管理員 ---
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
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self'"
    )

    # --- LINE Bot 設定 ---
    LINE_CHANNEL_SECRET: str = Field(default="")
    LINE_CHANNEL_ACCESS_TOKEN: str = Field(default="")

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
