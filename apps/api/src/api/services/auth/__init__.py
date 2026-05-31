"""Auth service package。對應 ADR-005、Phase D1。

對外的使用入口：

    from api.services.auth import get_provider

    provider = get_provider("google")
    redirect = await provider.start_auth(request)
    ...
    result = await provider.handle_callback(request)

Provider registry 在 api.services.auth.providers 載入時自動註冊。
"""

from api.services.auth.providers.base import (
    AuthProvider,
    AuthResult,
    UnknownProviderError,
    get_provider,
    register_provider,
    registered_providers,
)

__all__ = [
    "AuthProvider",
    "AuthResult",
    "UnknownProviderError",
    "get_provider",
    "register_provider",
    "registered_providers",
]
