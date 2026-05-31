#!/usr/bin/env python3
"""匯入既有法規 — 現行法規（法條docx檔）＋ 已廢止法規（頂層獨立 PDF）。

- 現行法規：套用條文結構，沿革逐筆寫入版本歷程，標記為現行公布（PUBLISHED）。
- 已廢止法規：同樣套用結構與沿革，保存後標記廢止（is_repealed / ARCHIVED），僅供紀錄。
- 解析失敗者（疑似掃描檔）跳過並於結尾列出清單。
- 以「標題已存在」做冪等保護，可安全重跑。

用法：uv run --project apps/api python apps/api/scripts/import_regulations.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, "apps/api/src")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from api.core.config import settings

REPO_ROOT = Path(__file__).resolve().parents[3]
CURRENT_DIR = REPO_ROOT / "法條docx檔"
REPEALED_DIR = REPO_ROOT / "已廢止法規"
ORG_NAME = "國立新竹高級中學班級聯合自治會"
ORG_SHORT = "班聯會"
REPEAL_REASON = "既有已廢止法規，匯入僅供紀錄保存"


def _category_for(title: str):
    from api.models.regulation import RegulationCategory

    if "章程" in title:
        return RegulationCategory.CONSTITUTION
    if "辦法" in title:
        return RegulationCategory.PROCEDURE
    if "條例" in title or title.endswith("法"):
        return RegulationCategory.ORDINANCE
    return RegulationCategory.PROCEDURE


async def _get_or_create_org(session: AsyncSession) -> uuid.UUID:
    from api.models.org import Org

    existing = (
        await session.execute(select(Org).where(Org.name == ORG_NAME))
    ).scalar_one_or_none()
    if existing:
        return existing.id
    org = Org(
        id=uuid.uuid4(),
        name=ORG_NAME,
        prefix=ORG_SHORT,
        description="新竹高中班聯會學生自治法規庫",
        is_active=True,
    )
    session.add(org)
    await session.flush()
    print(f"  建立組織：{ORG_NAME}（id={org.id}）")
    return org.id


async def _get_creator(session: AsyncSession) -> uuid.UUID:
    from api.models.user import User

    user = (
        await session.execute(
            select(User).where(User.email == "ted981026@gmail.com")
        )
    ).scalar_one_or_none()
    if user is None:
        user = (
            await session.execute(select(User).order_by(User.created_at).limit(1))
        ).scalar_one_or_none()
    if user is None:
        raise SystemExit("找不到任何使用者，無法設定 created_by；請先建立至少一位使用者。")
    return user.id


async def _title_exists(session: AsyncSession, title: str) -> bool:
    from api.models.regulation import Regulation

    found = (
        await session.execute(select(Regulation.id).where(Regulation.title == title))
    ).first()
    return found is not None


async def _import_one(
    session: AsyncSession,
    path: Path,
    *,
    org_id: uuid.UUID,
    created_by: uuid.UUID,
    repealed: bool,
) -> tuple[str, str]:
    """回傳 (狀態, 訊息)。狀態：ok / skip / fail。"""
    from api.models.regulation import RegulationWorkflowStatus
    from api.services import regulation as reg_svc
    from api.services import regulation_import as reg_import_svc
    from api.services.regulation_import import split_history_events

    raw = path.read_bytes()
    try:
        data = await asyncio.to_thread(
            reg_import_svc.parse_regulation_document, raw, path.name
        )
    except ValueError as exc:
        return "fail", f"{path.name}：解析失敗 — {exc}"

    if await _title_exists(session, data.title):
        return "skip", f"{path.name}：標題「{data.title}」已存在，略過"

    reg = await reg_svc.create_regulation_from_import(
        session,
        data=data,
        category=_category_for(data.title),
        org_id=org_id,
        created_by=created_by,
    )
    reg = await reg_svc.publish_imported_regulation(
        session,
        reg,
        published_by=created_by,
        change_brief="匯入既有已廢止法規" if repealed else "匯入既有現行法規",
    )

    article_count = sum(1 for a in reg.articles if a.article_type.value == "article")
    event_count = len(split_history_events(reg.legislative_history))

    if repealed:
        reg.is_repealed = True
        reg.repealed_date = datetime.now(UTC)
        reg.repeal_reason = REPEAL_REASON
        reg.is_active = False
        reg.workflow_status = RegulationWorkflowStatus.ARCHIVED
        await session.flush()

    tag = "廢止" if repealed else "現行"
    return (
        "ok",
        f"{path.name} → 《{data.title}》[{tag}] 條文={article_count} "
        f"版本歷程={reg.version}（沿革事件={event_count}）",
    )


async def run(session: AsyncSession) -> None:
    org_id = await _get_or_create_org(session)
    created_by = await _get_creator(session)

    results: dict[str, list[str]] = {"ok": [], "skip": [], "fail": []}

    print("\n=== 現行法規（法條docx檔） ===")
    for path in sorted(CURRENT_DIR.glob("*.docx")):
        if path.name.startswith("~$"):
            continue
        status, msg = await _import_one(
            session, path, org_id=org_id, created_by=created_by, repealed=False
        )
        results[status].append(msg)
        print(f"  [{status}] {msg}")

    print("\n=== 已廢止法規（頂層獨立 PDF） ===")
    for path in sorted(REPEALED_DIR.glob("*.pdf")):
        status, msg = await _import_one(
            session, path, org_id=org_id, created_by=created_by, repealed=True
        )
        results[status].append(msg)
        print(f"  [{status}] {msg}")

    await session.commit()

    print("\n===== 匯入摘要 =====")
    print(f"成功 {len(results['ok'])} 筆、略過 {len(results['skip'])} 筆、失敗 {len(results['fail'])} 筆")
    if results["fail"]:
        print("\n--- 解析失敗（未匯入，請另行處理，如 OCR 後再匯）---")
        for msg in results["fail"]:
            print(f"  • {msg}")
    if results["skip"]:
        print("\n--- 略過（已存在）---")
        for msg in results["skip"]:
            print(f"  • {msg}")


async def main() -> None:
    engine = create_async_engine(str(settings.DATABASE_URL), echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)  # type: ignore[call-overload]
    async with async_session() as session:
        try:
            await run(session)
        except Exception as exc:
            await session.rollback()
            print(f"❌ 匯入失敗：{exc}")
            raise
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
