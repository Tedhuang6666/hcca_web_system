"""Authlib OAuth2 設定 - Google OpenID Connect"""

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

# 型別提示輔助
google: StarletteOAuth2App = oauth.google  # type: ignore[assignment]
