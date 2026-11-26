"""班聯按班級確認收款，獨立於學生的個別訂單。"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin


class ShopClassPayment(Base, TimestampMixin):
    __tablename__ = "shop_class_payments"
    __table_args__ = (Index("uq_shop_class_payments_class", "class_id", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_classes.id", ondelete="CASCADE"), nullable=False
    )
    is_paid: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
