"""ORM 基礎欄位 Mixin"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    """自動管理 created_at / updated_at 的 Mixin"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )


class SoftDeleteMixin:
    """統一軟刪除語意。

    欄位：
      deleted_at — NULL 表示未刪除，有值表示刪除時間。

    使用方式
    --------
    1. 在 model 繼承此 Mixin：

        class MyModel(Base, TimestampMixin, SoftDeleteMixin):
            ...

    2. 建立 Alembic migration：

        alembic revision --autogenerate -m "add deleted_at to my_model"

    3. Service 層呼叫 soft_delete() 取代 session.delete()：

        obj.soft_delete()

    4. 查詢時加上 active 過濾（漏加 = 還原前資料也查得到）：

        select(MyModel).where(MyModel.deleted_at.is_(None))

    5. 垃圾桶列表：

        select(MyModel).where(MyModel.deleted_at.is_not(None))
           .where(MyModel.deleted_at >= retention_cutoff)

    注意事項
    --------
    - 已有 `is_deleted: bool` 欄位的舊模型（如 RegulationArticle）暫不遷移，
      待下次大版本統一補齊。新增模組一律使用本 Mixin。
    - 若模組有垃圾桶頁，需在對應 router 加 `trash:restore` 權限碼。
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        index=True,
    )

    def soft_delete(self) -> None:
        """標記為刪除（設 deleted_at = now UTC）。呼叫後需 await session.flush()。"""
        self.deleted_at = datetime.now(UTC)

    def restore(self) -> None:
        """從垃圾桶還原（清除 deleted_at）。呼叫後需 await session.flush()。"""
        self.deleted_at = None

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
