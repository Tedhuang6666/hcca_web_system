"""電子證件特殊身分授權 ORM 模型。"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONList

DEFAULT_STUDENT_ID_PREFIXES = ("310", "410", "510")


class ElectronicCredentialAuthorization(Base, TimestampMixin):
    """以 Email 管理可在電子證件上顯示的特殊身分。"""

    __tablename__ = "electronic_credential_authorizations"
    __table_args__ = (
        UniqueConstraint("email", name="uq_electronic_credential_authorizations_email"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    identity_label: Mapped[str] = mapped_column(String(80), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class ElectronicCredentialSettings(Base, TimestampMixin):
    """單例電子證件資格設定。"""

    __tablename__ = "electronic_credential_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_electronic_credential_settings_singleton"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    student_id_prefixes: Mapped[list[str]] = mapped_column(
        JSONList,
        nullable=False,
        default=lambda: list(DEFAULT_STUDENT_ID_PREFIXES),
        server_default=text('\'["310", "410", "510"]\''),
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
