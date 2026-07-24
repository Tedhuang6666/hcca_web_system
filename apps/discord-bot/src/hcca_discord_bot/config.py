"""Standalone Bot settings."""

from __future__ import annotations

from collections.abc import Iterable

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.discord-bot"),
        extra="ignore",
    )

    HCCA_API_URL: str = Field(
        default="",
        validation_alias=AliasChoices("HCCA_API_URL", "HCCA_DISCORD_BOT_API_URL"),
    )
    HCCA_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("HCCA_API_KEY", "HCCA_DISCORD_BOT_API_KEY"),
    )
    HCCA_API_CF_ACCESS_CLIENT_ID: str = Field(
        default="",
        validation_alias=AliasChoices(
            "HCCA_API_CF_ACCESS_CLIENT_ID",
            "HCCA_DISCORD_BOT_CF_ACCESS_CLIENT_ID",
        ),
    )
    HCCA_API_CF_ACCESS_CLIENT_SECRET: str = Field(
        default="",
        validation_alias=AliasChoices(
            "HCCA_API_CF_ACCESS_CLIENT_SECRET",
            "HCCA_DISCORD_BOT_CF_ACCESS_CLIENT_SECRET",
        ),
    )
    FRONTEND_BASE_URL: str = Field(default="")
    DISCORD_BOT_TOKEN: str = Field(default="")
    DISCORD_GUILD_ID: str = Field(default="")
    DISCORD_COMMAND_SYNC_GUILD_ID: str = Field(default="")

    def missing(self, names: Iterable[str]) -> list[str]:
        return [name for name in names if not getattr(self, name).strip()]


settings = Settings()
