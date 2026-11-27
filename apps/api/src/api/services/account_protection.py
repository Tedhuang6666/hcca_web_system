"""高權限帳號的共用保護規則。

`routers/admin.py` 的使用者編輯已禁止停用 owner、非 superuser 修改 superuser；
學籍異動與個資假名化走不同權限（system:user_lifecycle、system:privacy），也必須套用同一規則，
否則持有這些較低權限的人可以凍結或假名化 owner／superuser，等同接管或癱瘓管理帳號。
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.user import User

ANONYMIZED_EMAIL_SUFFIX = "@deleted.local"


def is_privileged_email(email: str) -> bool:
    privileged = {
        address.strip().lower() for address in [*settings.OWNER_EMAILS, *settings.SUPERUSER_EMAILS]
    }
    return email.strip().lower() in privileged


def is_owner(user: User) -> bool:
    owners = {email.strip().lower() for email in settings.OWNER_EMAILS}
    return user.email.strip().lower() in owners


async def protected_target(
    db: AsyncSession, *, requester: User, target_id: uuid.UUID, action_label: str
) -> User:
    """取得目標帳號並檢查 owner／superuser 保護；不符合時拋出 HTTPException。"""
    target = await db.get(User, target_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")
    if is_owner(target):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Owner 帳號不可{action_label}"
        )
    if target.is_superuser and not requester.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"僅超級管理員可{action_label}超級管理員帳號",
        )
    return target


def is_anonymized(user: User) -> bool:
    return user.email.endswith(ANONYMIZED_EMAIL_SUFFIX)
