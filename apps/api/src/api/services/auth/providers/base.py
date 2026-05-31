"""AuthProvider Protocol 與 registry。對應 ADR-005、Phase D1。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from fastapi import Request
from starlette.responses import RedirectResponse


@dataclass(slots=True)
class AuthResult:
    """provider 回傳的標準化結果。"""

    provider: str
    """provider 名稱（如 "google"）。"""

    external_id: str
    """provider 端的不可變 ID（Google sub、SAML NameID、OIDC sub）。"""

    email: str | None = None
    """provider 回傳的 email，可能為 None（如某些 SAML 設定）。"""

    full_name: str | None = None
    """顯示用姓名。"""

    avatar_url: str | None = None

    raw_profile: dict[str, Any] = field(default_factory=dict)
    """原始 provider profile（debug / 擴充用）。不放 secrets。"""

    is_email_verified: bool = False


@runtime_checkable
class AuthProvider(Protocol):
    """所有 SSO provider 共用介面。"""

    name: str
    """唯一識別。命名建議 `<kind>` 或 `<kind>:<scope>`，例如 `google`、`oidc:hchs`。"""

    enabled: bool
    """目前是否啟用。讀 settings / DB 動態決定。"""

    async def start_auth(self, request: Request) -> RedirectResponse:
        """產生 IdP 登入 URL 並 redirect 過去。"""
        ...

    async def handle_callback(self, request: Request) -> AuthResult:
        """從 IdP callback 中取出標準化 AuthResult。

        失敗時應 raise HTTPException（401 / 502）並寫 audit log。
        """
        ...


class UnknownProviderError(LookupError):
    """get_provider 未找到對應 provider。"""


_REGISTRY: dict[str, AuthProvider] = {}


def register_provider(provider: AuthProvider) -> None:
    """登記一個 provider。重複 name 會覆寫並警告。"""
    name = provider.name
    if name in _REGISTRY:
        # 不 raise，避免 hot reload 時 import 失敗；但建議寫 log
        import logging

        logging.getLogger(__name__).warning(
            "auth provider %r already registered; overwriting", name
        )
    _REGISTRY[name] = provider


def get_provider(name: str) -> AuthProvider:
    """取得 provider。未註冊 raise UnknownProviderError。"""
    try:
        return _REGISTRY[name]
    except KeyError as exc:
        raise UnknownProviderError(
            f"Auth provider {name!r} not registered. Available: {sorted(_REGISTRY)}"
        ) from exc


def registered_providers() -> list[AuthProvider]:
    """列出所有已註冊 provider（含 enabled=False 的）。"""
    return list(_REGISTRY.values())


__all__ = [
    "AuthProvider",
    "AuthResult",
    "UnknownProviderError",
    "get_provider",
    "register_provider",
    "registered_providers",
]
