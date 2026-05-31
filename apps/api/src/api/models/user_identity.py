"""使用者外部身份綁定。對應 ADR-005、Phase D1。

一個 User 可綁定多個 UserIdentity（學校信箱 OIDC、個人 Gmail、未來政府數位身份）。
任一 identity 可用於登入，登入後都導到同一個 User。

Provider 名稱對應 api.services.auth.providers 下 module name。
external_id：provider 端的不可變 ID（Google sub、SAML NameID、OIDC sub）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin


class UserIdentity(Base, TimestampMixin):
    """單一外部身份綁定。"""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "external_id",
            name="uq_user_identities_provider_external_id",
        ),
        Index("ix_user_identities_user", "user_id"),
        Index("ix_user_identities_provider_email", "provider", "email"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    """如 "google" | "oidc:hchs" | "saml:school" | "cas:hchs"。"""

    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    """provider 端不可變 ID（Google sub / SAML NameID / OIDC sub）。"""

    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    """provider 端回傳的 email（可能與 User.email 不同）。"""

    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    """provider 端回傳的姓名快照。"""

    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<UserIdentity id={self.id} provider={self.provider} user_id={self.user_id}>"


__all__ = ["UserIdentity"]
