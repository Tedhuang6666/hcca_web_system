"""通用 OIDC provider adapter，對應 ADR-005。

用途：對接學校的 OIDC IdP（如校務系統）。實際運作需：
1. 環境變數 / DB 提供 OIDC discovery URL + client_id / secret
2. 跑過 discovery、取得 jwks_uri 與 authorization_endpoint / token_endpoint
3. 完成 OAuth2 authorization code flow

目前先註冊 provider 介面；實際邏輯標 NotImplemented，
完成時把 routers/auth.py 既有 OAuth flow 抽離成 provider-shared 邏輯。

啟用條件：env `OIDC_DISCOVERY_URL` 與 `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` 三者皆設。
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
class OIDCProvider:
    """通用 OpenID Connect 1.0 provider 骨架。

    完整接上校務 IdP 時：
    - 用 httpx + jose 處理 discovery / jwks / id_token 驗證
    - PKCE（建議 S256）
    - nonce + state 防 CSRF
    """

    name: str = "oidc"

    @property
    def enabled(self) -> bool:
        # 透過環境變數靜態啟用；之後可換成 DB-backed AuthProviderConfig
        discovery = getattr(settings, "OIDC_DISCOVERY_URL", "") or ""
        client_id = getattr(settings, "OIDC_CLIENT_ID", "") or ""
        client_secret = getattr(settings, "OIDC_CLIENT_SECRET", "") or ""
        return bool(discovery and client_id and client_secret)

    async def start_auth(self, request: Request) -> RedirectResponse:
        if not self.enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OIDC provider 未設定（OIDC_DISCOVERY_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET）",
            )
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="OIDCProvider.start_auth 尚未實作",
        )

    async def handle_callback(self, request: Request) -> AuthResult:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="OIDCProvider.handle_callback 尚未實作",
        )


@dataclass(slots=True)
class SAMLProvider:
    """SAML 2.0 provider 骨架。教育部 / 學校系統常用。

    後續用 python3-saml 或 authlib 完整化。
    """

    name: str = "saml"

    @property
    def enabled(self) -> bool:
        return bool(getattr(settings, "SAML_METADATA_URL", ""))

    async def start_auth(self, request: Request) -> RedirectResponse:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="SAMLProvider 尚未實作",
        )

    async def handle_callback(self, request: Request) -> AuthResult:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="SAMLProvider 尚未實作",
        )


# 註冊
register_provider(OIDCProvider())  # type: ignore[arg-type]
register_provider(SAMLProvider())  # type: ignore[arg-type]


__all__ = ["OIDCProvider", "SAMLProvider"]
