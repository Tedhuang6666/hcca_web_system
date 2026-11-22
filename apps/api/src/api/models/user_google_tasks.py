"""Google Tasks 使用者層級授權設定 ORM 模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.core.field_crypto import decrypt_field, encrypt_field
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class UserGoogleTasksConfig(Base, TimestampMixin):
    """記錄某個使用者連結的 Google Tasks OAuth token 與同步狀態。

    每個 user 最多一筆（UniqueConstraint on user_id）。
    access_token / refresh_token 以 Fernet 加密存放（FIELD_ENCRYPTION_KEYS）。
    """

    __tablename__ = "user_google_tasks_configs"
    __table_args__ = (UniqueConstraint("user_id", name="uq_user_google_tasks_configs_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # --- OAuth Tokens（加密存放）---
    _access_token_enc: Mapped[str | None] = mapped_column("access_token_enc", Text, nullable=True)
    _refresh_token_enc: Mapped[str | None] = mapped_column("refresh_token_enc", Text, nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- 授權帳號資訊 ---
    authorized_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Google Tasks 目標清單 ID ---
    google_tasklist_id: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # --- 同步狀態 ---
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # --- 控制開關 ---
    sync_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    # --- Relationship ---
    user: Mapped[User] = relationship("User")

    # --- Encrypted hybrid properties ---

    @hybrid_property
    def access_token(self) -> str | None:
        return decrypt_field(self._access_token_enc)

    @access_token.setter  # type: ignore[no-redef]
    def access_token(self, value: str | None) -> None:
        self._access_token_enc = encrypt_field(value)

    @hybrid_property
    def refresh_token(self) -> str | None:
        return decrypt_field(self._refresh_token_enc)

    @refresh_token.setter  # type: ignore[no-redef]
    def refresh_token(self, value: str | None) -> None:
        self._refresh_token_enc = encrypt_field(value)

    @property
    def is_connected(self) -> bool:
        return bool(self._refresh_token_enc)


__all__ = ["UserGoogleTasksConfig"]
