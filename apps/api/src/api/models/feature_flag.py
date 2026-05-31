"""Feature Flag model。Phase D3。

DB 後端的簡單灰度開關。對應路線圖 D3「自架 Unleash / GrowthBook」的縮減版：
不引第三方、只夠 HCCA 規模用。

開關策略（任一條件滿足即啟用）：
- is_globally_enabled = True → 全開
- percentage_rollout > 0    → 對 user_id hash 進 % 桶（穩定的灰度）
- enabled_user_ids 包含目標 → 明確 user list
- enabled_permission_codes 任一在 user permission set 中 → 角色灰度

使用：
    from api.services.feature_flag import is_enabled
    if await is_enabled(db, "new_approval_ui", user):
        ...
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONList


class FeatureFlag(Base, TimestampMixin):
    """單一 feature flag 設定。"""

    __tablename__ = "feature_flags"
    __table_args__ = (
        UniqueConstraint("key", name="uq_feature_flags_key"),
        Index("ix_feature_flags_enabled", "is_globally_enabled"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    key: Mapped[str] = mapped_column(String(100), nullable=False)
    """flag 識別字串，例如 "new_approval_ui"、"document_cc"。"""

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_globally_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    percentage_rollout: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    """0-100；對 user_id hash 取餘決定是否啟用。0 = 不灰度。"""

    enabled_user_ids: Mapped[list[str]] = mapped_column(JSONList, nullable=False, default=list)
    """明確列出啟用的 user_id（str list）。"""

    enabled_permission_codes: Mapped[list[str]] = mapped_column(
        JSONList, nullable=False, default=list
    )
    """符合任一 permission code 的使用者啟用。例：對所有 admin:* 先試。"""

    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """flag 不再使用後（內建為 True 或永遠 False）可歸檔。"""

    def __repr__(self) -> str:
        return (
            f"<FeatureFlag key={self.key!r} global={self.is_globally_enabled} "
            f"pct={self.percentage_rollout}>"
        )


__all__ = ["FeatureFlag"]
