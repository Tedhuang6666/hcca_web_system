"""外部組織預購來源與匯入帳本；不替填答人建立登入帳號。"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList


class ShopSheetSource(Base, TimestampMixin):
    __tablename__ = "shop_sheet_sources"
    __table_args__ = (UniqueConstraint("spreadsheet_id", "sheet_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    spreadsheet_id: Mapped[str] = mapped_column(String(200))
    sheet_name: Mapped[str] = mapped_column(String(100))
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("product_categories.id", ondelete="RESTRICT")
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    config: Mapped[dict] = mapped_column(JSONDict, default=dict, server_default="{}")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(500))


class ShopSheetRow(Base, TimestampMixin):
    __tablename__ = "shop_sheet_rows"
    __table_args__ = (UniqueConstraint("source_id", "response_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("shop_sheet_sources.id", ondelete="CASCADE"), index=True
    )
    response_key: Mapped[str] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64))
    row_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="review")
    error: Mapped[str | None] = mapped_column(String(500))
    # 保留已建訂單的 ID，即使管理者日後清除訂單，也不可因重抓而復活。
    order_ids: Mapped[list[str]] = mapped_column(JSONList, default=list, server_default="[]")
