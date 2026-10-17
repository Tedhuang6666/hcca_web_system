"""學生本人確認班級與座號的紀錄。"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin


class ClassConfirmation(Base, TimestampMixin):
    __tablename__ = "class_confirmations"
    __table_args__ = (
        CheckConstraint("seat_number BETWEEN 1 AND 999", name="ck_confirmation_seat"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_classes.id", ondelete="CASCADE"), index=True
    )
    student_id: Mapped[str] = mapped_column(String(20), nullable=False)
    seat_number: Mapped[int] = mapped_column(Integer, nullable=False)
