"""公文關鍵字搜尋不得成為探測密件內容的管道。"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import (
    Document,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.org import Org
from api.models.user import User
from api.services.document._access import list_documents


def _doc(org: Org, creator: User, **fields: object) -> Document:
    defaults: dict = {
        "serial_number": f"DOC-{uuid.uuid4().hex[:8]}",
        "title": "一般公文",
        "org_id": org.id,
        "created_by": creator.id,
        "status": DocumentStatus.APPROVED,
        "subject": "主旨",
        "visibility_level": DocumentVisibility.PUBLIC,
        "content": "一般內容",
    }
    defaults.update(fields)
    return Document(**defaults)


async def test_keyword_search_does_not_match_others_confidential_documents(
    db_session: AsyncSession, make_user
) -> None:
    org = Org(name=f"搜尋組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    author = await make_user(email="secret-author@example.com")
    viewer = await make_user(email="secret-viewer@example.com")
    secret = _doc(
        org,
        author,
        title="機密案",
        content="內含關鍵字：校長人事異動",
        classification=DocumentClassification.CONFIDENTIAL,
    )
    ordinary = _doc(org, author, content="公開說明校長人事異動流程")
    own_secret = _doc(
        org,
        viewer,
        content="我的機密草案提到校長人事異動",
        classification=DocumentClassification.CONFIDENTIAL,
    )
    db_session.add_all([secret, ordinary, own_secret])
    await db_session.flush()

    found = await list_documents(db_session, keyword="校長人事異動", viewer_id=viewer.id, limit=50)
    listed = await list_documents(db_session, viewer_id=viewer.id, limit=50)

    found_ids = {doc.id for doc in found}
    assert ordinary.id in found_ids
    assert own_secret.id in found_ids
    assert secret.id not in found_ids
    assert secret.id in {doc.id for doc in listed}


async def test_autosave_on_issued_document_still_records_revision(
    db_session: AsyncSession, make_user
) -> None:
    from datetime import UTC, datetime

    from sqlalchemy import func, select

    from api.models.document import DocumentRevision
    from api.schemas.document import DocumentUpdate
    from api.services.document import update_document

    org = Org(name=f"發文組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    author = await make_user(email="issued-author@example.com")
    issued = _doc(org, author, content="原始發文內容", issued_at=datetime.now(UTC))
    draft = _doc(org, author, status=DocumentStatus.DRAFT, content="草稿")
    db_session.add_all([issued, draft])
    await db_session.flush()

    await update_document(
        db_session,
        issued,
        data=DocumentUpdate(content="發文後修改", autosave=True),
        changed_by=author.id,
    )
    await update_document(
        db_session,
        draft,
        data=DocumentUpdate(content="草稿自動儲存", autosave=True),
        changed_by=author.id,
    )

    async def revisions(doc: Document) -> int:
        return await db_session.scalar(
            select(func.count())
            .select_from(DocumentRevision)
            .where(DocumentRevision.document_id == doc.id)
        )

    assert await revisions(issued) == 1
    assert await revisions(draft) == 0
