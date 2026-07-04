"""Authlib OAuth2 設定 - Google OpenID Connect 與 Discord OAuth2。"""

from authlib.integrations.starlette_client import OAuth, StarletteOAuth2App

from api.core.config import settings

oauth = OAuth()

oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": "openid email profile",
        "prompt": "select_account",
    },
)

oauth.register(
    name="google_calendar",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": "https://www.googleapis.com/auth/calendar",
        "access_type": "offline",
        "prompt": "consent",
    },
)

oauth.register(
    name="discord",
    client_id=settings.DISCORD_CLIENT_ID,
    client_secret=settings.DISCORD_CLIENT_SECRET,
    access_token_url="https://discord.com/api/oauth2/token",
    authorize_url="https://discord.com/api/oauth2/authorize",
    api_base_url="https://discord.com/api/",
    client_kwargs={"scope": "identify"},
)

# 型別提示輔助
google: StarletteOAuth2App = oauth.google  # type: ignore[assignment]
google_calendar: StarletteOAuth2App = oauth.google_calendar  # type: ignore[assignment]
discord: StarletteOAuth2App = oauth.discord  # type: ignore[assignment]
