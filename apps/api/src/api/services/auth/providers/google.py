"""Google OAuth2 provider adapter，對應 ADR-005。

目前先註冊 provider 介面，實際登入邏輯仍在
[apps/api/src/api/routers/auth.py]。後續把 OAuth flow 邏輯
遷移到 GoogleOAuth2Provider.start_auth / handle_callback。

遷移順序建議：
1. 此 module 先 register 一個 "google" provider（即使方法 raise NotImplemented）
2. 寫遷移測試（mock OAuth、確認 AuthResult 結構正確）
3. 逐步把 auth.py 的 google_callback 邏輯搬過來
4. auth.py 改成 thin wrapper 呼叫 get_provider("google")
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, Request, status
from starlette.responses import RedirectResponse

from api.core.config import settings
from api.services.auth.providers.base import (
    AuthResult,
    register_provider,
)

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class GoogleOAuth2Provider:
    """Google OAuth2 implementation of AuthProvider.

    Google OAuth2 provider adapter。
    """

    name: str = "google"

    @property
    def enabled(self) -> bool:
        return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)

    async def start_auth(self, request: Request) -> RedirectResponse:
        """目前轉發到既有 router。遷移後內含 OAuth init 邏輯。"""
        # 遷移期：保留呼叫舊路徑、避免破壞既有登入
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="GoogleOAuth2Provider.start_auth 尚未遷移；請繼續使用 /auth/google/login",
        )

    async def handle_callback(self, request: Request) -> AuthResult:
        """目前轉發到既有 router。遷移後內含 token exchange + userinfo 邏輯。"""
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="GoogleOAuth2Provider.handle_callback 尚未遷移；請繼續使用 /auth/google/callback",
        )


# 註冊（Protocol 上是 runtime_checkable，dataclass 滿足 structural typing）
register_provider(GoogleOAuth2Provider())  # type: ignore[arg-type]


__all__ = ["GoogleOAuth2Provider"]
