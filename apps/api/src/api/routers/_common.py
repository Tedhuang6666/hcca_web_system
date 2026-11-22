"""Router 共用小工具。"""

from __future__ import annotations

from fastapi import HTTPException, status


def or_404[T](value: T | None, detail: str) -> T:
    """value 為 None 時拋 404，否則原樣回傳。

    取代散落在各 router 的 `_xxx_or_404` 樣板（查 → if None: raise → return）；
    呼叫端仍自行決定要查什麼、要不要疊加額外條件（例如歸屬檢查），
    只把「找不到就 404」這段收斂成單一決策點。
    """
    if value is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return value
