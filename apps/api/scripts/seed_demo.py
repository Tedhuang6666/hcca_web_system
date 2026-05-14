#!/usr/bin/env python3
"""
Demo data seed script — 一鍵生成組織架構、職位、測試使用者、公文與法規
用法：uv run --project apps/api python apps/api/scripts/seed_demo.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, date, datetime

# 確保能 import api package
sys.path.insert(0, "apps/api/src")

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from api.core.config import settings


async def seed(session: AsyncSession) -> None:
    from api.models.document import (
        Document,
        DocumentCategory,
        DocumentClassification,
        DocumentSerialTemplate,
        DocumentStatus,
        DocumentUrgency,
        DocumentVisibility,
        YearMode,
    )
    from api.models.org import Org, Permission, Position, UserPosition
    from api.models.regulation import (
        ArticleType,
        Regulation,
        RegulationArticle,
        RegulationCategory,
        RegulationWorkflowStatus,
    )
    from api.models.user import User
    from api.services.document import allocate_serial

    # ── 1. 建立組織 ──────────────────────────────────────────────────────────
    org = Org(
        id=uuid.uuid4(),
        name="嶺東科技大學學生代表大會",
        short_name="嶺代",
        description="HCCA Demo 組織",
        is_active=True,
    )
    session.add(org)
    await session.flush()

    # ── 2. 建立使用者 ─────────────────────────────────────────────────────────
    from api.core.security import get_password_hash
    users_data = [
        ("議長", "president@demo.hcca.tw", True),
        ("書記長", "secretary@demo.hcca.tw", False),
        ("代表甲", "rep_a@demo.hcca.tw", False),
        ("代表乙", "rep_b@demo.hcca.tw", False),
    ]
    users: list[User] = []
    for display_name, email, is_admin in users_data:
        u = User(
            id=uuid.uuid4(),
            email=email,
            hashed_password=get_password_hash("Demo@1234"),
            display_name=display_name,
            is_active=True,
            is_verified=True,
            is_superuser=is_admin,
        )
        session.add(u)
        users.append(u)
    await session.flush()

    president, secretary, rep_a, rep_b = users

    # ── 3. 建立職位 ───────────────────────────────────────────────────────────
    perms_map = {
        "議長": ["admin:all", "document:create", "document:approve", "document:admin",
                 "regulation:create", "regulation:publish", "regulation:admin",
                 "regulation:president_publish", "doc.issue"],
        "書記長": ["document:create", "document:approve", "document:submit",
                  "regulation:create", "regulation:submit", "regulation:schedule",
                  "regulation:council_approve"],
        "代表": ["document:create", "document:submit"],
    }

    def make_position(name: str, org_id: uuid.UUID, perm_codes: list[str]) -> Position:
        p = Position(
            id=uuid.uuid4(), org_id=org_id, name=name, is_active=True,
            permissions=[Permission(id=uuid.uuid4(), code=c) for c in perm_codes],
        )
        return p

    pos_president = make_position("議長", org.id, perms_map["議長"])
    pos_secretary = make_position("書記長", org.id, perms_map["書記長"])
    pos_rep = make_position("代表", org.id, perms_map["代表"])
    session.add_all([pos_president, pos_secretary, pos_rep])
    await session.flush()

    today = date.today()
    end_date = date(today.year + 1, today.month, today.day)
    session.add_all([
        UserPosition(id=uuid.uuid4(), user_id=president.id, position_id=pos_president.id,
                     org_id=org.id, start_date=today, end_date=end_date),
        UserPosition(id=uuid.uuid4(), user_id=secretary.id, position_id=pos_secretary.id,
                     org_id=org.id, start_date=today, end_date=end_date),
        UserPosition(id=uuid.uuid4(), user_id=rep_a.id, position_id=pos_rep.id,
                     org_id=org.id, start_date=today, end_date=end_date),
        UserPosition(id=uuid.uuid4(), user_id=rep_b.id, position_id=pos_rep.id,
                     org_id=org.id, start_date=today, end_date=end_date),
    ])
    await session.flush()

    # ── 4. 字號模板 ───────────────────────────────────────────────────────────
    tmpl = DocumentSerialTemplate(
        id=uuid.uuid4(), org_id=org.id, org_prefix="嶺代",
        category_char="生", year_mode=YearMode.ROC,
        reset_on_new_year=True, is_active=True,
        current_year=datetime.now().year - 1911,
        counter=0, created_by=president.id,
    )
    session.add(tmpl)
    await session.flush()

    # ── 5. 建立示範公文 ───────────────────────────────────────────────────────
    docs_data = [
        ("112學年度第一次大會開會通知", DocumentStatus.APPROVED, DocumentCategory.MEETING_NOTICE),
        ("申請購置辦公設備函", DocumentStatus.PENDING, DocumentCategory.LETTER),
        ("活動場地借用申請", DocumentStatus.DRAFT, DocumentCategory.REPORT),
        ("第二學期預算核准函", DocumentStatus.APPROVED, DocumentCategory.DECREE),
        ("課外活動中心協調會開會通知", DocumentStatus.REJECTED, DocumentCategory.MEETING_NOTICE),
    ]
    for title, doc_status, category in docs_data:
        serial = await allocate_serial(session, tmpl)
        doc = Document(
            id=uuid.uuid4(),
            serial_number=serial,
            title=title,
            org_id=org.id,
            category=category,
            urgency=DocumentUrgency.NORMAL,
            classification=DocumentClassification.NORMAL,
            visibility_level=DocumentVisibility.PUBLIC,
            is_public=(doc_status == DocumentStatus.APPROVED),
            status=doc_status,
            content=f"# {title}\n\n本公文為示範資料，由 seed script 自動生成。",
            subject=f"主旨：{title}",
            created_by=rep_a.id,
            handler_name=rep_a.display_name,
            handler_unit="代表處",
        )
        session.add(doc)
    await session.flush()

    # ── 6. 建立示範法規 ───────────────────────────────────────────────────────
    regs_data = [
        ("嶺東科技大學學生代表大會組織章程", RegulationCategory.CONSTITUTION, True),
        ("嶺東科技大學學生代表大會議事規則", RegulationCategory.ORDINANCE, True),
        ("學生代表選舉辦法", RegulationCategory.PROCEDURE, False),
    ]
    for title, category, is_published in regs_data:
        reg = Regulation(
            id=uuid.uuid4(),
            title=title,
            category=category,
            content=f"## {title}\n\n### 第一章 總則\n\n本規則為示範資料。",
            org_id=org.id,
            created_by=president.id,
            is_active=True,
            version=1,
            workflow_status=RegulationWorkflowStatus.PUBLISHED if is_published else RegulationWorkflowStatus.DRAFT,
            published_at=datetime.now(UTC) if is_published else None,
        )
        session.add(reg)
        await session.flush()

        # 加幾條示範條文
        articles = [
            RegulationArticle(
                id=uuid.uuid4(), regulation_id=reg.id,
                sort_index=0, article_type=ArticleType.CHAPTER,
                title="總則", subtitle="", content=None, is_deleted=False,
            ),
            RegulationArticle(
                id=uuid.uuid4(), regulation_id=reg.id,
                sort_index=1, article_type=ArticleType.ARTICLE,
                title="立法目的", subtitle="", is_deleted=False,
                content="本規則依據學生自治精神制定，以規範代表大會之運作。",
            ),
            RegulationArticle(
                id=uuid.uuid4(), regulation_id=reg.id,
                sort_index=2, article_type=ArticleType.ARTICLE,
                title="適用範圍", subtitle="", is_deleted=False,
                content="凡本校學生代表大會相關事務，均適用本規則。",
            ),
        ]
        session.add_all(articles)

    await session.flush()
    await session.commit()
    print("✅ Demo data seed 完成！")
    print(f"   組織：{org.name}")
    print("   使用者：議長/書記長/代表甲/代表乙（密碼：Demo@1234）")
    print(f"   公文：{len(docs_data)} 筆，法規：{len(regs_data)} 筆")


async def main() -> None:
    engine = create_async_engine(str(settings.DATABASE_URL), echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)  # type: ignore[call-overload]
    async with async_session() as session:
        # 確認 tables 存在
        try:
            await seed(session)
        except Exception as e:
            await session.rollback()
            print(f"❌ Seed 失敗：{e}")
            raise


if __name__ == "__main__":
    asyncio.run(main())
