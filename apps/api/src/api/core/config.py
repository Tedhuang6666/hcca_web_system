"""應用程式設定 - 使用 Pydantic Settings 管理環境變數"""

from pydantic import Field, PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    DEBUG: bool = False
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]

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
    SECRET_KEY: str = Field(default="CHANGE_ME_IN_PRODUCTION_USE_256_BIT_KEY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

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

    # --- LINE Bot 設定 ---
    LINE_CHANNEL_SECRET: str = Field(default="")
    LINE_CHANNEL_ACCESS_TOKEN: str = Field(default="")

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_set(cls, v: str) -> str:
        if v == "CHANGE_ME_IN_PRODUCTION_USE_256_BIT_KEY":
            import warnings

            warnings.warn("SECRET_KEY 使用預設值，請在生產環境中設定！", stacklevel=2)
        return v


settings = Settings()
