"""共用 service 工具函式"""
from __future__ import annotations

from pydantic import BaseModel


def apply_updates(entity: object, data: BaseModel, *, exclude_none: bool = False) -> dict:
    """將 Pydantic schema 中有設定的欄位套用到 SQLAlchemy model 實例上。

    回傳 payload dict，供後續 event 記錄使用。
    exclude_none=True 時額外過濾 None 值（用於以 None 表示「不傳」的舊式 schema）。
    """
    payload = data.model_dump(exclude_unset=True, exclude_none=exclude_none)
    for key, value in payload.items():
        setattr(entity, key, value)
    return payload
