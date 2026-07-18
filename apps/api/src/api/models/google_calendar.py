"""Google Calendar 組織層級授權設定 ORM 模型。"""

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
    from api.models.org import Org
    from api.models.user import User


class OrgGoogleCalendarConfig(Base, TimestampMixin):
    """記錄某個組織連結的 Google Calendar OAuth token 與同步狀態。

    每個 org 最多一筆（UniqueConstraint on org_id）。
    access_token / refresh_token 以 Fernet 加密存放（FIELD_ENCRYPTION_KEYS）。
    """

    __tablename__ = "org_google_calendar_configs"
    __table_args__ = (UniqueConstraint("org_id", name="uq_org_google_calendar_configs_org"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # --- OAuth Tokens（加密存放）---
    _access_token_enc: Mapped[str | None] = mapped_column("access_token_enc", Text, nullable=True)
    _refresh_token_enc: Mapped[str | None] = mapped_column("refresh_token_enc", Text, nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- 授權帳號資訊（顯示用）---
    authorized_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    authorized_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --- 目標 Google Calendar ---
    google_calendar_id: Mapped[str] = mapped_column(
        String(256), nullable=False, server_default="primary"
    )

    # --- 增量同步狀態 ---
    sync_token: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sync_token_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_pull_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # --- 控制開關 ---
    sync_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    # --- Relationships ---
    org: Mapped[Org] = relationship("Org")
    authorized_by_user: Mapped[User | None] = relationship("User", foreign_keys=[authorized_by])

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
        """是否已完成 OAuth 授權（有 refresh_token）。"""
        return bool(self._refresh_token_enc)
