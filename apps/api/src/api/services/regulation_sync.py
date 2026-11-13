"""來源比對與版本同步；同一組織以資料列鎖序列化，逐份 savepoint 保護。"""

from __future__ import annotations

import asyncio
import re
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowStatus,
)
from api.models.regulation_sync import RegulationSyncSource
from api.models.user import User
from api.schemas.regulation_sync import RegulationSyncItemOut, RegulationSyncReportOut
from api.services import regulation as reg_svc
from api.services.audit import record
from api.services.permission import get_user_permission_codes_for_org
from api.services.regulation_drive import DOCX_MIME, DriveFile, RegulationDriveClient
from api.services.regulation_import import (
    ImportedRegulationDraft,
    parse_history_date_info,
    parse_regulation_document,
    split_history_events,
)


def next_sync(frequency: str, now: datetime) -> datetime | None:
    if frequency == "manual":
        return None
    return now + timedelta(days=7 if frequency == "weekly" else 1)


def normalized_title(title: str) -> str:
    return re.sub(r"[\s\u3000]+", "", title)


def latest_date(history: str | None) -> datetime | None:
    dates = [
        info[0]
        for event in split_history_events(history)
        if (info := parse_history_date_info(event))[0] is not None
    ]
    return max(dates, default=None)


def _node_values(rows: list, *, imported: bool) -> list[tuple]:
    paths: dict = {}
    result = []
    for row in sorted(rows, key=lambda item: item.sort_index):
        if not imported and row.is_deleted:
            continue
        parent = row.parent_key if imported else row.parent_id
        identity = row.key if imported else row.id
        path = (*paths.get(parent, ()), (row.article_type, row.legal_number, row.order_index))
        paths[identity] = path
        result.append((path, row.title or "", row.content or ""))
    return result


def matches(reg: Regulation, draft: ImportedRegulationDraft, repealed: bool) -> bool:
    return (
        # 結構化正文是比對依據，避免 Markdown 清單符號等呈現差異製造假修訂。
        (reg.preface or "") == (draft.preface or "")
        and re.sub(r"\s+", "", reg.legislative_history or "")
        == re.sub(r"\s+", "", draft.legislative_history or "")
        and reg.is_repealed == repealed
        and _node_values(reg.articles, imported=False)
        == _node_values(draft.articles, imported=True)
    )


async def _replace_articles(
    session: AsyncSession, reg: Regulation, draft: ImportedRegulationDraft
) -> None:
    # 保留同一結構路徑的 id / lineage_id；移除的節點僅軟刪除，保住既有參照。
    existing: dict[tuple, RegulationArticle] = {}
    paths: dict = {}
    for old_row in sorted(reg.articles, key=lambda item: item.sort_index):
        if old_row.is_deleted:
            continue
        path = (
            *paths.get(old_row.parent_id, ()),
            (old_row.article_type, old_row.legal_number or str(old_row.order_index)),
        )
        paths[old_row.id] = path
        if path in existing:
            raise ValueError("系統條文結構有重複節點，需先人工核對")
        existing[path] = old_row
    imported_paths: dict = {}
    ids: dict = {}
    kept: set = set()
    for item in draft.articles:
        path = (
            *imported_paths.get(item.parent_key, ()),
            (item.article_type, item.legal_number or str(item.order_index)),
        )
        imported_paths[item.key] = path
        row = existing.get(path)
        if row is None:
            row = RegulationArticle(id=uuid.uuid4(), regulation_id=reg.id, subtitle="")
            reg.articles.append(row)
        row.article_type, row.legal_number = item.article_type, item.legal_number
        row.title, row.content = item.title, item.content
        row.sort_index, row.order_index = item.sort_index, item.order_index
        row.parent_id = ids.get(item.parent_key)
        row.is_deleted = False
        ids[item.key] = row.id
        kept.add(row.id)
    for row in reg.articles:
        if row.id not in kept:
            row.is_deleted = True
    reg.articles.sort(key=lambda row: row.sort_index)
    await session.flush()


def _snapshot(reg: Regulation, actor: uuid.UUID, brief: str, when: datetime) -> RegulationRevision:
    return RegulationRevision(
        regulation_id=reg.id,
        version=reg.version,
        change_brief=brief,
        is_total_amendment=True,
        content_snapshot=reg.content or "",
        article_snapshot=reg_svc._article_snapshot_json(reg.articles),
        proposal_metadata_snapshot=reg.proposal_metadata,
        amended_at=when,
        amended_by=actor,
    )


def validate_draft(draft: ImportedRegulationDraft) -> None:
    if "草案" in draft.title or len(draft.title) > 200:
        raise ValueError("來源標題疑似混入草案或正文，需人工核對")
    articles = [item for item in draft.articles if item.article_type == ArticleType.ARTICLE]
    numbers = [item.legal_number for item in articles]
    if not numbers or len(numbers) != len(set(numbers)):
        raise ValueError("條號缺漏或重複，未更新法規")
    if draft.warnings:
        raise ValueError("解析需要人工核對：" + "；".join(draft.warnings))
    if any(
        re.search(r"第\s*[零〇一二三四五六七八九十百千兩0-9０-９之－-]+\s*條", line)
        for item in articles
        for line in (item.content or "").splitlines()
        if line.lstrip().startswith("第") and re.match(r"^第.+條\s", line)
    ):
        # 行首的未拆條號可能來自抽取錯誤；避免靜默合併整段。
        raise ValueError("正文疑似包含未拆開的條號，需人工核對")


async def apply_document(
    session: AsyncSession,
    source: RegulationSyncSource,
    file: DriveFile,
    draft: ImportedRegulationDraft,
) -> RegulationSyncItemOut:
    validate_draft(draft)
    candidates = (
        (
            await session.execute(
                reg_svc._reg_query_with_relations().where(
                    Regulation.org_id == source.org_id,
                    Regulation.workflow_status.in_(
                        [
                            RegulationWorkflowStatus.PUBLISHED,
                            RegulationWorkflowStatus.ARCHIVED,
                        ]
                    ),
                )
            )
        )
        .scalars()
        .unique()
        .all()
    )
    candidates = [
        reg
        for reg in candidates
        if normalized_title(reg.title) == normalized_title(draft.title)
        and reg.is_repealed == file.repealed
    ]
    if file.repealed and len(candidates) > 1:
        candidates = [
            reg
            for reg in candidates
            if latest_date(reg.legislative_history) == latest_date(draft.legislative_history)
        ]
    if len(candidates) > 1:
        raise ValueError("系統有多筆同名法規，需人工指定版本後再同步")
    linked = source.manifest.get(file.id, {}).get("regulation_id")
    if linked and linked not in {str(reg.id) for reg in candidates}:
        raise ValueError("來源檔案已連結其他法規或標題已變更，需人工核對，避免重複建檔")
    reg = candidates[0] if candidates else None
    outcome: Literal["created", "updated"] = "created"
    detail = "已匯入來源最新版"
    incoming_date = latest_date(draft.legislative_history)
    if reg:
        if matches(reg, draft, file.repealed):
            return RegulationSyncItemOut(
                filename=file.name,
                title=draft.title,
                file_id=file.id,
                status="unchanged",
                detail="條號、正文及沿革一致",
                regulation_id=reg.id,
                article_count=sum(a.article_type == ArticleType.ARTICLE for a in draft.articles),
            )
        existing_date = latest_date(reg.legislative_history)
        if existing_date and (incoming_date is None or incoming_date < existing_date):
            raise ValueError("來源沿革日期較舊或不明，已保留系統新版")
        if reg.freeze_at or reg.is_repealed and not file.repealed:
            raise ValueError("法規已凍結或廢止，不自動恢復生效")
        # 來源由此組織的法規管理員明確指定，只更新同組織、同名的版本。
        now = datetime.now(UTC)
        if not any(
            rev.version == reg.version and rev.content_snapshot == reg.content
            for rev in reg.revisions
        ):
            if any(rev.version == reg.version for rev in reg.revisions):
                reg.version = max([reg.version, *(rev.version for rev in reg.revisions)]) + 1
            reg.revisions.append(
                _snapshot(reg, source.created_by, "來源同步前備份", existing_date or now)
            )
        reg.version = max([reg.version, *(rev.version for rev in reg.revisions)]) + 1
        await _replace_articles(session, reg, draft)
        reg.content, reg.preface = draft.content, draft.preface
        reg.legislative_history = draft.legislative_history
        reg.revisions.append(
            _snapshot(reg, source.created_by, "Drive 來源同步／解析校正", incoming_date or now)
        )
        outcome, detail = "updated", "已更新正文、沿革及條文結構，保留修訂快照"
    else:
        title = normalized_title(draft.title)
        category = (
            RegulationCategory.CONSTITUTION
            if "章程" in title
            else RegulationCategory.PROCEDURE
            if "辦法" in title
            else RegulationCategory.ORDINANCE
            if "條例" in title or title.endswith("法")
            else RegulationCategory.PROCEDURE
        )
        reg = await reg_svc.import_regulation_document(
            session,
            data=draft,
            category=category,
            org_id=source.org_id,
            created_by=source.created_by,
            publish_immediately=True,
        )
    if file.repealed:
        reg.is_repealed, reg.is_active = True, False
        reg.workflow_status = RegulationWorkflowStatus.ARCHIVED
        reg.repeal_reason = "來源已列於已廢止法規資料夾"
        # 未知廢止日保留 null，不把同步時間當法律生效日期。
    await session.flush()
    await record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.drive_sync",
        actor_id=str(source.created_by),
        summary=f"Drive 同步「{reg.title}」",
        meta={"file_id": file.id, "outcome": outcome},
    )
    return RegulationSyncItemOut(
        filename=file.name,
        title=draft.title,
        file_id=file.id,
        status=outcome,
        detail=detail,
        regulation_id=reg.id,
        article_count=sum(a.article_type == ArticleType.ARTICLE for a in draft.articles),
    )


async def synchronize_source(
    session: AsyncSession, source_id: uuid.UUID
) -> RegulationSyncReportOut | None:
    source = (
        await session.execute(
            select(RegulationSyncSource)
            .where(RegulationSyncSource.id == source_id)
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if source is None:
        return None
    now = datetime.now(UTC)
    if source.requested_at is None and (source.next_sync_at is None or source.next_sync_at > now):
        return None
    report = RegulationSyncReportOut(checked_at=now)
    try:
        actor = await session.get(User, source.created_by)
        codes = await get_user_permission_codes_for_org(session, source.created_by, source.org_id)
        if (
            actor is None
            or not actor.is_active
            or not (actor.is_superuser or "regulation:admin" in codes)
        ):
            raise ValueError("設定者已無此組織的法規管理權限，請由現任管理員重新儲存來源")
        groups: dict[str, list] = defaultdict(list)
        failed_titles: set[str] = set()
        async with RegulationDriveClient() as drive:
            files = await drive.list_files(source.folder_id)
            for file in files:
                try:
                    raw, filename = await drive.download(file)
                    draft = await asyncio.to_thread(parse_regulation_document, raw, filename)
                    groups[normalized_title(draft.title)].append((file, draft))
                except ValueError as exc:
                    failed_titles.add(
                        normalized_title(re.sub(r"\.(pdf|docx)$", "", file.name, flags=re.I))
                    )
                    report.items.append(
                        RegulationSyncItemOut(
                            filename=file.name, file_id=file.id, status="error", detail=str(exc)
                        )
                    )
        for title, variants in groups.items():
            if title in failed_titles:
                for file, draft in variants:
                    report.items.append(
                        RegulationSyncItemOut(
                            filename=file.name,
                            title=draft.title,
                            file_id=file.id,
                            status="skipped",
                            detail="同名來源有解析失敗版本，暫停覆寫以免選到舊稿",
                        )
                    )
                continue
            # 有現行來源時不以歷史廢止檔覆蓋；法律沿革優先，同日以 Word 精準抽取。
            current = [pair for pair in variants if not pair[0].repealed]
            pool = current or variants
            pool.sort(
                key=lambda pair: (
                    latest_date(pair[1].legislative_history) or datetime.min.replace(tzinfo=UTC),
                    pair[0].mime_type in {DOCX_MIME, "application/vnd.google-apps.document"},
                ),
                reverse=True,
            )
            file, draft = pool[0]
            try:
                async with session.begin_nested():
                    item = await apply_document(session, source, file, draft)
                if item.regulation_id:
                    source.manifest = {
                        **source.manifest,
                        file.id: {"regulation_id": str(item.regulation_id)},
                    }
                report.items.append(item)
            except ValueError as exc:
                report.items.append(
                    RegulationSyncItemOut(
                        filename=file.name,
                        title=draft.title,
                        file_id=file.id,
                        status="error",
                        detail=str(exc),
                    )
                )
            for other, other_draft in variants:
                if other.id != file.id:
                    report.items.append(
                        RegulationSyncItemOut(
                            filename=other.name,
                            title=other_draft.title,
                            file_id=other.id,
                            status="skipped",
                            detail=f"同名版本，採用 {file.name}（依沿革日期，日期相同優先 Word）",
                        )
                    )
        if not any(item.status == "error" for item in report.items):
            source.last_synced_at = now
    except ValueError as exc:
        report.error = str(exc)
    source.last_report = report.model_dump(mode="json")
    source.requested_at = None
    source.next_sync_at = next_sync(source.frequency, now)
    await session.flush()
    return report
