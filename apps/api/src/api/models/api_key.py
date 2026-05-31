"""對外 API Key model。對應 Phase D2。

設計：
- 明文 key 只在建立時回傳一次（之後看不到，忘了只能 revoke 重發）
- DB 存 sha256 hash + 可選的 encrypted 明文 mirror（用 field_crypto）
- 每把 key 獨立 rate limit
- scopes 是 permission code list（同 RBAC 體系）
- 可設過期時間、可隨時 revoke

使用：
- 第三方系統呼叫公開 API 帶 X-API-Key header
- service 層查 hash、驗 active、扣 rate limit budget、檢查 scopes
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONList


class ApiKey(Base, TimestampMixin):
    """對外 API Key。"""

    __tablename__ = "api_keys"
    __table_args__ = (
        UniqueConstraint("key_hash", name="uq_api_keys_key_hash"),
        Index("ix_api_keys_owner", "owner_user_id"),
        Index("ix_api_keys_revoked", "revoked_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    """key 用途描述，例如 "圖書館借書系統整合"。"""

    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    """key 前 8 chars，前端顯示時用（識別不洩漏）。"""

    key_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    """key 完整字串的 sha256/argon2 hash（看實作）。"""

    encrypted_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    """可選的 encrypted 明文 mirror（用 field_crypto.encrypt_field 包）。
    僅供 "需要 displays once again" 場景（多 admin 共用 key）；通常為 NULL。
    """

    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    scopes: Mapped[list[str]] = mapped_column(JSONList, nullable=False, default=list)
    """allowed permission codes，例如 ["read:announcements", "write:webhooks"]。"""

    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    """每分鐘 request 上限；rate limit middleware 會用 key_id 做 bucket。"""

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """過期時間；NULL = 不過期。建議永遠設一個。"""

    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    last_used_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    revoked_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def __repr__(self) -> str:
        return f"<ApiKey id={self.id} name={self.name!r} prefix={self.key_prefix}>"


__all__ = ["ApiKey"]
