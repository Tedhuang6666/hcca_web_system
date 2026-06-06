"""欄位加密漸進輪替 Celery tasks，對應 ADR-006。

什麼時候用：
- 已產生新 FIELD_ENCRYPTION_KEY，env 設成 `<new>,<old>`
- 想把所有舊資料漸進 re-encrypt 為新 key、之後就能 env 改成 `<new>`

排程建議：
- 一次性：手動觸發 `rotate_user_mfa_secrets.delay()` 跑到回 status=clean
- 或加 beat：每日 04:00 跑、直到所有資料完成

機制：
- 對每張涉敏感欄位的表掃 N=200 筆
- 用 field_crypto.rotate_token() 重新加密（用新 key 包既有 plaintext）
- batch commit、可重入

注意：
- 相關 model 必須先提供 encrypted 欄位，此 task 才會執行輪替
- 欄位尚未就緒時會安全略過，方便先驗證排程與重入行為
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import select

from api.core.celery_app import celery_app
from api.core.field_crypto import (
    FieldEncryptionNotConfigured,
    is_configured,
    rotate_token,
)

logger = logging.getLogger(__name__)

BATCH_SIZE = 200


async def _rotate_model_async(
    model_class: Any,
    enc_attr: str,
    batch_size: int,
) -> dict:
    """掃指定 model 的 enc_attr 欄位、用最新 key re-encrypt。

    enc_attr：實際存密文的欄位名稱（如 "totp_secret_enc"）。
    """
    if not is_configured():
        return {"status": "skipped", "reason": "FIELD_ENCRYPTION_KEYS not set"}

    from api.core.database import task_session

    rotated = 0
    examined = 0

    async with task_session() as db:
        col = getattr(model_class, enc_attr)
        stmt = (
            select(model_class).where(col.is_not(None)).order_by(model_class.id).limit(batch_size)
        )
        rows = list((await db.execute(stmt)).scalars().all())
        for row in rows:
            examined += 1
            current = getattr(row, enc_attr)
            try:
                new_token = rotate_token(current)
            except FieldEncryptionNotConfigured:
                return {"status": "skipped", "reason": "keys cleared during run"}
            except Exception:
                logger.exception("rotate token failed for %s.id=%s", model_class.__name__, row.id)
                continue
            if new_token != current:
                setattr(row, enc_attr, new_token)
                rotated += 1
        await db.commit()

    return {
        "status": "ok",
        "model": model_class.__name__,
        "attr": enc_attr,
        "examined": examined,
        "rotated": rotated,
        "more": examined == batch_size,
    }


@celery_app.task(name="api.services.field_crypto_tasks.rotate_user_mfa_secrets")
def rotate_user_mfa_secrets(batch_size: int = BATCH_SIZE) -> dict:
    """Batch rotate User.mfa_secret 欄位。"""
    from api.models.user import User

    # 注意：User 目前仍需先提供 totp_secret_enc 欄位；欄位未就緒時略過。
    if not hasattr(User, "mfa_secret_enc"):
        return {
            "status": "skipped",
            "reason": "User.mfa_secret_enc field not introduced yet",
        }
    return asyncio.run(_rotate_model_async(User, "mfa_secret_enc", batch_size))


__all__ = ["rotate_user_mfa_secrets"]
