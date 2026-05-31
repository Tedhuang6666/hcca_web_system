"""Auth providers — 透過 import 副作用觸發 register。

新增 provider 時：
1. 在本 package 下開 `<name>.py`
2. 實作 AuthProvider Protocol
3. 在 module 末呼叫 `register_provider(...)`
4. 在此檔 import 該 module（觸發 register）

注意：目前僅將 Google adapter 規格化為 module；實際邏輯仍在
`apps/api/src/api/routers/auth.py` 中。Phase D1 完成時遷移到此 module。
"""

# 載入即註冊各 provider
from api.services.auth.providers import (
    google,  # noqa: F401
    oidc,  # noqa: F401
)

__all__: list[str] = []
