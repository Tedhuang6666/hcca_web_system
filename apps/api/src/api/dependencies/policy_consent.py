"""政策同意 dependency（ADR-003）。

掛在需要「使用者必須同意當前政策才能繼續」的端點上：

    @router.post(
        "/documents",
        dependencies=[
            Depends(require_permission("document:create")),
            Depends(require_policy_consent),
        ],
    )

預設行為：未同意 raise 412 Precondition Failed + header `X-Policy-Pending: true`。
前端攔截後彈 PolicyConsentBanner / Modal。

設計考量：
- 不擋讀取（GET /me、GET /announcements）→ 只 enforce 寫入端點，避免 UX 崩
- pending 清單前端用 /policies/me/pending 取
- Superuser **不繞過**（要做表率）
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services import policy as policy_svc


class PolicyConsentChecker:
    """阻擋尚未同意當前政策（requires_explicit_consent=True）的使用者。"""

    async def __call__(
        self,
        current_user: Annotated[User, Depends(get_current_active_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> User:
        pending = await policy_svc.pending_consents(db, current_user.id)
        if pending:
            kinds = sorted({p.kind for p in pending})
            raise HTTPException(
                status_code=status.HTTP_412_PRECONDITION_FAILED,
                detail=f"請先同意目前生效的政策：{', '.join(kinds)}",
                headers={
                    "X-Policy-Pending": "true",
                    "X-Policy-Pending-Kinds": ",".join(kinds),
                },
            )
        return current_user


require_policy_consent = PolicyConsentChecker()


__all__ = ["PolicyConsentChecker", "require_policy_consent"]
