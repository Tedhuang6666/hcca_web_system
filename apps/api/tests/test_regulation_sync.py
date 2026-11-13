"""法規來源同步與條號解析回歸；資料層使用真實測試 session。"""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
from zipfile import ZipFile

import pytest
from sqlalchemy import select

from api.core.config import settings
from api.models.org import Org, Permission, Position, UserPosition
from api.models.regulation import ArticleType, Regulation
from api.models.regulation_sync import RegulationSyncSource
from api.services import regulation as reg_svc
from api.services import regulation_sync as sync
from api.services.regulation_drive import DriveFile
from api.services.regulation_import import parse_regulation_document, parse_regulation_text


def _document(lines: list[str]) -> bytes:
    out = BytesIO()
    with ZipFile(out, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            + "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in lines)
            + "</w:body></w:document>",
        )
    return out.getvalue()


@pytest.mark.parametrize(
    "label",
    ["第四之一條", "第四條之一", "第4-1條", "第４－１條", "第 四 之 一 條", "第四\u200b之一條"],
)
@pytest.mark.parametrize("format", ["docx", "text", "markdown", "pdf"])
def test_inserted_articles_keep_number_body_and_order(label, format, monkeypatch):
    lines = ["測試條例", "第四條原條文。", label + "增訂條文。", "第五條後條文。"]
    if format == "docx":
        draft = parse_regulation_document(_document(lines), "測試條例.docx")
    elif format == "pdf":

        class Page:
            def extract_text(self):
                return "\n".join(lines)

        class Reader:
            pages = [Page()]

            def __init__(self, _):
                pass

        monkeypatch.setattr("api.services.regulation_import.PdfReader", Reader)
        draft = parse_regulation_document(b"%PDF", "測試條例.pdf")
    else:
        content = "\n".join(lines[1:])
        if format == "markdown":
            content = "# 測試條例\n" + "\n".join("### " + line for line in lines[1:])
        draft = parse_regulation_text(title="測試條例", content=content)
    articles = [row for row in draft.articles if row.article_type == ArticleType.ARTICLE]
    assert [row.legal_number for row in articles] == ["4", "4-1", "5"]
    assert [row.content for row in articles] == ["原條文。", "增訂條文。", "後條文。"]


def test_zero_width_character_does_not_hide_article():
    draft = parse_regulation_text(
        title="活動辦法", content="第四條前文。\n第五\u200b條工作分組。\n第六條後文。"
    )
    assert [row.legal_number for row in draft.articles] == ["4", "5", "6"]


async def _source(db, user):
    org = Org(name="同步測試組織")
    db.add(org)
    await db.flush()
    source = RegulationSyncSource(
        org_id=org.id,
        created_by=user.id,
        folder_id="abcdefghijk",
        frequency="daily",
        manifest={},
        last_report={},
        requested_at=datetime.now(UTC),
    )
    db.add(source)
    await db.flush()
    return source


def _draft(body="原文。", history="115年6月23日修正通過"):
    return parse_regulation_text(
        title="測試條例", content=f"{history}\n第四條{body}\n第四之一條增訂條文。\n第五條後文。"
    )


async def test_sync_repairs_same_date_preserves_ids_history_and_is_idempotent(
    db_session, make_user
):
    user = await make_user(is_superuser=True)
    source = await _source(db_session, user)
    old = parse_regulation_text(
        title="測試條例",
        content="115年6月23日修正通過\n第四條原文。第四之一條增訂條文。\n第五條後文。",
    )
    reg = await reg_svc.import_regulation_document(
        db_session,
        data=old,
        category="ordinance",
        org_id=source.org_id,
        created_by=user.id,
        publish_immediately=True,
    )
    old_id = next(a.id for a in reg.articles if a.legal_number == "4")
    old_version = reg.version
    file = DriveFile("abcdefghijk", "測試條例.docx", "docx")
    result = await sync.apply_document(db_session, source, file, _draft())
    assert result.status == "updated"
    assert reg.version == old_version + 1
    assert next(a.id for a in reg.articles if a.legal_number == "4") == old_id
    assert any(rev.content_snapshot == old.content for rev in reg.revisions)
    assert [a.legal_number for a in reg.articles if not a.is_deleted] == ["4", "4-1", "5"]
    result = await sync.apply_document(db_session, source, file, _draft())
    assert result.status == "unchanged"
    assert reg.version == old_version + 1


async def test_sync_rejects_older_source_without_creating_duplicate(db_session, make_user):
    user = await make_user(is_superuser=True)
    source = await _source(db_session, user)
    file = DriveFile("abcdefghijk", "測試條例.docx", "docx")
    await sync.apply_document(db_session, source, file, _draft())
    with pytest.raises(ValueError, match="較舊"):
        await sync.apply_document(
            db_session, source, file, _draft("舊文。", "114年6月23日修正通過")
        )
    assert len((await db_session.scalars(select(Regulation))).all()) == 1


async def test_manual_import_same_version_does_not_duplicate(db_session, make_user):
    user = await make_user(is_superuser=True)
    source = await _source(db_session, user)
    first = await reg_svc.import_regulation_document(
        db_session,
        data=_draft(),
        category="ordinance",
        org_id=source.org_id,
        created_by=user.id,
        publish_immediately=True,
    )
    second = await reg_svc.import_regulation_document(
        db_session,
        data=_draft(),
        category="ordinance",
        org_id=source.org_id,
        created_by=user.id,
        publish_immediately=True,
        update_existing=True,
    )
    assert first.id == second.id


async def test_sync_routes_permissions_and_schedule(
    db_session, make_user, authed_client_factory, client, monkeypatch
):
    user = await make_user(is_superuser=True)
    source = await _source(db_session, user)
    path = f"/regulations/sync/{source.org_id}"
    assert (await client.get(path)).status_code == 401
    outsider = await make_user()
    ac = authed_client_factory(outsider)
    assert (await ac.get(path)).status_code == 403
    owner = authed_client_factory(user)
    response = await owner.put(
        path,
        json={
            "folder_id": "https://drive.google.com/drive/folders/abcdefghijk",
            "frequency": "weekly",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["source"]["frequency"] == "weekly"
    assert response.json()["source"]["next_sync_at"]
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    response = await owner.post(path + "/run")
    assert response.status_code == 202, response.text
    assert response.json()["source"]["requested_at"]
    response = await owner.put(path, json={"folder_id": "abcdefghijk", "frequency": "manual"})
    assert response.json()["source"]["next_sync_at"] is None


async def test_sync_does_not_allow_admin_from_another_org(
    db_session, make_user, authed_client_factory
):
    user = await make_user()
    source = await _source(db_session, user)
    other = Org(name="另一組織")
    db_session.add(other)
    await db_session.flush()
    position = Position(org_id=other.id, name="法規管理員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code="regulation:admin"))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=datetime.now(UTC).date() - timedelta(days=1),
        )
    )
    await db_session.flush()
    ac = authed_client_factory(user)
    assert (await ac.get(f"/regulations/sync/{source.org_id}")).status_code == 403
    assert (await ac.put(f"/regulations/sync/{source.org_id}", json={})).status_code == 403
    assert (await ac.post(f"/regulations/sync/{source.org_id}/run")).status_code == 403


async def test_scheduled_sync_keeps_successful_files_and_reports_failures(
    db_session, make_user, monkeypatch
):
    user = await make_user(is_superuser=True)
    source = await _source(db_session, user)
    good = DriveFile("goodfile1234", "測試條例.docx", "docx")
    bad = DriveFile("badfile12345", "無法解析.pdf", "application/pdf")

    class Drive:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def list_files(self, _):
            return [good, bad]

        async def download(self, file):
            if file == bad:
                raise ValueError("掃描檔需 OCR")
            return _document(
                [
                    "測試條例",
                    "115年6月23日修正通過",
                    "第四條原文。",
                    "第四之一條增訂條文。",
                    "第五條後文。",
                ]
            ), good.name

    monkeypatch.setattr(sync, "RegulationDriveClient", Drive)
    report = await sync.synchronize_source(db_session, source.id)
    assert report is not None
    assert sorted(item.status for item in report.items) == ["created", "error"]
    assert source.requested_at is None
    assert source.next_sync_at > datetime.now(UTC)
    assert source.last_synced_at is None
    assert len((await db_session.scalars(select(Regulation))).all()) == 1
    assert await sync.synchronize_source(db_session, source.id) is None


async def test_duplicate_source_numbers_require_review():
    duplicate = parse_regulation_text(
        title="來源有誤條例", content="第四十三條前段。\n第四十四條前段。\n第四十三條另一章。"
    )
    with pytest.raises(ValueError, match="重複"):
        sync.validate_draft(duplicate)


def test_inline_subparagraph_space_is_not_swallowed():
    draft = parse_regulation_text(
        title="測試條例", content="第一條會員義務： 一、配合行政。 二、繳納會費。"
    )
    assert [row.legal_number for row in draft.articles] == ["1", "1", "2"]
    assert draft.articles[0].content == "會員義務："


async def test_task_commits_report_before_invalidating_public_cache(
    db_session, make_user, monkeypatch
):
    from api.core import cache, database
    from api.services import regulation_tasks

    user = await make_user(is_superuser=True)
    source = await _source(db_session, user)

    @asynccontextmanager
    async def task_session():
        yield db_session

    class Drive:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def list_files(self, _):
            return [DriveFile("testfile1234", "測試條例.docx", "docx")]

        async def download(self, _):
            return _document(["測試條例", "第一條規定。"]), "測試條例.docx"

    cleared = []

    async def invalidate(pattern):
        if pattern.startswith("reg:public:"):
            assert not db_session.in_transaction()
            cleared.append(pattern)

    monkeypatch.setattr(database, "task_session", task_session)
    monkeypatch.setattr(sync, "RegulationDriveClient", Drive)
    monkeypatch.setattr(cache, "cache_invalidate", invalidate)
    assert await regulation_tasks._sync_due_sources() == {"completed": 1}
    assert cleared == ["reg:public:v1:org:*"]
    assert source.requested_at is None
    assert source.last_synced_at is not None
