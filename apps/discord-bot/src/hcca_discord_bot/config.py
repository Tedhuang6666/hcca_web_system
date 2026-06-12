"""Standalone Bot settings."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    HCCA_API_URL: str = Field(default="http://localhost:8000")
    HCCA_API_KEY: str = Field(default="")
    FRONTEND_BASE_URL: str = Field(default="http://localhost:3000")
    DISCORD_BOT_TOKEN: str = Field(default="")
    DISCORD_GUILD_ID: str = Field(default="")
    DISCORD_COMMAND_SYNC_GUILD_ID: str = Field(default="")


settings = Settings()
