"""Authlib OAuth2 設定 - Google OpenID Connect 與 Discord OAuth2。"""

from authlib.integrations.starlette_client import OAuth, StarletteOAuth2App

from api.core.config import settings

oauth = OAuth()

# Google 的 discovery document 不會變更登入端點，但 Authlib 會在第一次
# authorize_redirect 時同步等待遠端 discovery。將穩定的 OIDC metadata 內建，
# 讓登入按鈕立即重導向；callback 仍會按 jwks_uri 驗證 Google 的 ID Token。
GOOGLE_OIDC_METADATA = {
    "_loaded_at": 0,
    "issuer": "https://accounts.google.com",
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    "id_token_signing_alg_values_supported": ["RS256"],
}

oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    **GOOGLE_OIDC_METADATA,
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
    **GOOGLE_OIDC_METADATA,
    client_kwargs={
        "scope": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/spreadsheets",
        "access_type": "offline",
        "prompt": "consent",
    },
)

oauth.register(
    name="google_tasks",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    **GOOGLE_OIDC_METADATA,
    client_kwargs={
        "scope": "https://www.googleapis.com/auth/tasks openid email",
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
google_tasks: StarletteOAuth2App = oauth.google_tasks  # type: ignore[assignment]
discord: StarletteOAuth2App = oauth.discord  # type: ignore[assignment]
