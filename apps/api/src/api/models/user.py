"""User ORM 模型"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.notification import Notification


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 學號（用於信箱預設 g0{student_id}@hchs.hc.edu.tw，管理員可預先指派）
    student_id: Mapped[str | None] = mapped_column(
        String(20), unique=True, nullable=True, index=True
    )

    # Google OAuth2 欄位
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)

    # 個人聯絡資訊（用於公文承辦人自動填入）
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    show_phone: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_email: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # 帳號狀態
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 超級管理員（繞過所有 RBAC 檢查，由 SUPERUSER_EMAILS 環境變數自動授予）
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 通知偏好設定（空 dict = 全部啟用；可覆蓋個別類型：{"document_pending": false}）
    notification_preferences: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )

    # 關聯 (P2 展開)
    positions: Mapped[list["UserPosition"]] = relationship(  # noqa: F821
        "UserPosition", back_populates="user", lazy="select"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification", back_populates="user", lazy="select", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"
