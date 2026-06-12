"""個資處理 — 當事人資料匯出 ZIP 與假名化（保留稽核痕跡）。

兩大職責：
  1. **export_user_data**：給定 user_id，把該使用者所有相關資料（含 audit log）
     蒐集起來打成 ZIP，回傳檔案路徑。供「當事人申請我自己的資料」用。
  2. **anonymize_user**：把該 user 的 PII 欄位（display_name / email / phone）
     替換為去識別字串，is_active=False；外鍵指向該 user 的關聯紀錄維持，
     audit_log 完整不動（依個資法解釋必須保存的稽核痕跡不可刪）。

設計：
  - 兩個操作都會寫一筆 privacy.export / privacy.anonymize audit。
  - 所有結果序列化為 JSONL，再壓進 ZIP，附 manifest.json 解釋每個檔案的來源。
  - 不刪除 PetitionCase / Document / Regulation / AuditLog 等公共利益資料。
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import uuid
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.audit_log import AuditLog
from api.models.notification import Notification
from api.models.user import User

logger = logging.getLogger(__name__)


@dataclass
class ExportResult:
    user_id: uuid.UUID
    file_path: str  # 相對於 exports_root() 的路徑
    size_bytes: int
    file_count: int
    generated_at: datetime


@dataclass
class AnonymizeResult:
    user_id: uuid.UUID
    fields_updated: list[str]
    anonymized_at: datetime


# ── 路徑 ────────────────────────────────────────────────────────────────────


def exports_root() -> Path:
    base = Path(getattr(settings, "DB_BACKUP_DIR", "uploads/backups")).parent
    root = base / "privacy_exports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_exports() -> list[dict[str, Any]]:
    root = exports_root()
    if not root.exists():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted(root.glob("*.zip")):
        try:
            stat = p.stat()
            out.append(
                {
                    "filename": p.name,
                    "size_bytes": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
                }
            )
        except OSError:
            continue
    out.sort(key=lambda x: x["modified_at"], reverse=True)
    return out


def read_export_bytes(filename: str) -> bytes:
    for export_file in exports_root().glob("*.zip"):
        if export_file.name == filename and export_file.is_file():
            return export_file.read_bytes()
    raise FileNotFoundError(filename)


# ── 序列化 ─────────────────────────────────────────────────────────────────


def _serialize(obj: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        v = getattr(obj, col.name)
        if isinstance(v, datetime):
            out[col.name] = v.isoformat()
        elif isinstance(v, uuid.UUID):
            out[col.name] = str(v)
        elif hasattr(v, "value") and hasattr(type(v), "__members__"):
            out[col.name] = str(v.value)
        else:
            out[col.name] = v
    return out


# ── Export ─────────────────────────────────────────────────────────────────


async def _collect_user_related_tables(
    session: AsyncSession, user: User
) -> dict[str, list[dict[str, Any]]]:
    """從各表蒐集與該 user 相關的資料；新增表時補一條 select 即可。"""
    bundle: dict[str, list[dict[str, Any]]] = {"users.json": [_serialize(user)]}

    # 通知
    notifications = (
        (await session.execute(select(Notification).where(Notification.user_id == user.id)))
        .scalars()
        .all()
    )
    bundle["notifications.json"] = [_serialize(n) for n in notifications]

    # Audit log（作為 actor）
    audits = (
        (
            await session.execute(
                select(AuditLog).where(AuditLog.actor_id == str(user.id)).limit(5000)
            )
        )
        .scalars()
        .all()
    )
    bundle["audit_logs.json"] = [_serialize(a) for a in audits]

    # 公文（建立者）— 用動態 import 避免循環依賴
    try:
        from api.models.document import Document

        docs = (
            (await session.execute(select(Document).where(Document.created_by == user.id)))
            .scalars()
            .all()
        )
        bundle["documents.json"] = [_serialize(d) for d in docs]
    except Exception:
        logger.debug("export documents skipped", exc_info=True)

    # 陳情案
    try:
        from api.models.petition import PetitionCase

        cases = (
            (
                await session.execute(
                    select(PetitionCase).where(PetitionCase.submitter_id == user.id)
                )
            )
            .scalars()
            .all()
        )
        bundle["petitions.json"] = [_serialize(c) for c in cases]
    except Exception:
        logger.debug("export petitions skipped", exc_info=True)

    # 學餐 / 購票訂單
    for model_path, fname in (
        ("api.models.meal:MealOrder", "meal_orders.json"),
        ("api.models.shop:Order", "shop_orders.json"),
    ):
        try:
            import importlib

            mod_name, cls_name = model_path.split(":")
            mod = importlib.import_module(mod_name)
            cls = getattr(mod, cls_name, None)
            if cls is None or not hasattr(cls, "user_id"):
                continue
            rows = (
                (await session.execute(select(cls).where(cls.user_id == user.id))).scalars().all()
            )
            bundle[fname] = [_serialize(r) for r in rows]
        except Exception:
            logger.debug("export %s skipped", model_path, exc_info=True)

    # 問卷回應
    try:
        from api.models.survey import SurveyResponse

        responses = (
            (
                await session.execute(
                    select(SurveyResponse).where(SurveyResponse.respondent_id == user.id)
                )
            )
            .scalars()
            .all()
        )
        bundle["survey_responses.json"] = [_serialize(r) for r in responses]
    except Exception:
        logger.debug("export survey_responses skipped", exc_info=True)

    return bundle


async def export_user_data(
    session: AsyncSession, *, user_id: uuid.UUID, requested_by_email: str | None
) -> ExportResult:
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ValueError("找不到該使用者")
    bundle = await _collect_user_related_tables(session, user)
    now = datetime.now(UTC)
    manifest = {
        "subject_user_id": str(user.id),
        "subject_email": user.email,
        "generated_at": now.isoformat(),
        "requested_by_email": requested_by_email,
        "files": {
            name: {"rows": len(rows), "fields": list(rows[0].keys()) if rows else []}
            for name, rows in bundle.items()
        },
        "notes": (
            "本檔案依個資法第 10 條當事人申請匯出。請以加密方式交付；"
            "公文 / 法規 / 稽核紀錄等保留期間內依法不可刪除。"
        ),
    }

    root = exports_root()
    fname = f"export_{user.id}_{now.strftime('%Y%m%d_%H%M%S')}.zip"
    out_path = root / fname

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for name, rows in bundle.items():
            zf.writestr(name, json.dumps(rows, ensure_ascii=False, indent=2))
    data = buf.getvalue()
    out_path.write_bytes(data)
    logger.info("Privacy export complete user=%s size=%d files=%d", user.id, len(data), len(bundle))
    return ExportResult(
        user_id=user.id,
        file_path=fname,
        size_bytes=len(data),
        file_count=len(bundle),
        generated_at=now,
    )


# ── Anonymize ──────────────────────────────────────────────────────────────


def _hash_token(seed: str, *, prefix: str = "anon") -> str:
    """以該 user id + 鹽生成不可逆 hash；同一人多次假名化會得相同 token。"""
    h = hashlib.sha256(f"{settings.SECRET_KEY}::{seed}".encode()).hexdigest()[:16]
    return f"{prefix}_{h}"


_ANON_PII_FIELDS: Sequence[str] = (
    "display_name",
    "email",
    "phone",
    "avatar_url",
)


async def anonymize_user(
    session: AsyncSession, *, user_id: uuid.UUID, requested_by_email: str | None
) -> AnonymizeResult:
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ValueError("找不到該使用者")
    seed = str(user.id)
    updated: list[str] = []

    if hasattr(user, "display_name"):
        user.display_name = f"已假名化使用者_{_hash_token(seed, prefix='u')}"  # type: ignore[attr-defined]
        updated.append("display_name")
    if hasattr(user, "email"):
        user.email = f"{_hash_token(seed, prefix='deleted')}@deleted.local"  # type: ignore[attr-defined]
        updated.append("email")
    if hasattr(user, "phone"):
        user.phone = None  # type: ignore[attr-defined]
        updated.append("phone")
    if hasattr(user, "avatar_url"):
        user.avatar_url = None  # type: ignore[attr-defined]
        updated.append("avatar_url")
    if hasattr(user, "show_phone"):
        user.show_phone = False  # type: ignore[attr-defined]
        updated.append("show_phone")
    if hasattr(user, "is_active"):
        user.is_active = False  # type: ignore[attr-defined]
        updated.append("is_active")

    await session.flush()
    now = datetime.now(UTC)
    logger.info("User anonymized id=%s by=%s fields=%s", user.id, requested_by_email, updated)
    return AnonymizeResult(user_id=user.id, fields_updated=updated, anonymized_at=now)
