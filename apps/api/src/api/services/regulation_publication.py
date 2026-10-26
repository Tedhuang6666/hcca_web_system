"""法規主席公布流程：保留路由授權，由此處編排快照、公文、audit 與 outbox。"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import (
    DocumentCategory,
    DocumentClassification,
    DocumentSerialTemplate,
    DocumentUrgency,
    DocumentVisibility,
)
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationRevision,
    RegulationWorkflowLog,
    RegulationWorkflowStatus,
)
from api.models.user import User
from api.schemas.document import DocumentCreate
from api.schemas.regulation import WorkflowActionRequest
from api.services import audit as audit_svc
from api.services import document as doc_svc
from api.services import regulation as reg_svc

logger = logging.getLogger(__name__)


async def publish_regulation(
    session: AsyncSession,
    reg: Regulation,
    payload: WorkflowActionRequest,
    current_user: User,
    *,
    invalidate_cache: Callable[[uuid.UUID], Awaitable[None]],
) -> Regulation:
    try:
        import json

        from sqlalchemy import select as _sel

        def _normalize_article_type(value: str | ArticleType) -> ArticleType:
            return value if isinstance(value, ArticleType) else ArticleType(value)

        def _render_article_line(
            *,
            article_type: str | ArticleType,
            legal_number: str | None,
            title: str | None,
            content: str | None,
        ) -> str:
            normalized = _normalize_article_type(article_type)
            if normalized == ArticleType.ARTICLE:
                prefix = f"第 {legal_number or title or '?'} 條"
                body = (content or "").strip()
                return f"{prefix}　{body}".strip()
            return (content or title or "").strip()

        def _article_match_key(
            article_type: object,
            lineage_id: object,
            legal_number: object,
            title: object,
        ) -> str | None:
            """跨版本比對鍵：優先用 lineage_id（沿革識別碼，重新排序時保持穩定），
            舊快照尚無 lineage_id 時才 fallback 到法號/標題。

            不可用條文 id：修正案經 fork_regulation_draft 後條文會取得全新 UUID，
            以 id 比對會讓所有條文被誤判為「新增 + 刪除」。
            """
            if _normalize_article_type(article_type) != ArticleType.ARTICLE:
                return None
            if lineage_id:
                return f"lin:{lineage_id}"
            key = str(legal_number or "").strip() or str(title or "").strip()
            return f"num:{key}" if key else None

        def _build_amendment_body(
            previous_rows: list[dict], current_rows: list[RegulationArticle]
        ) -> str:
            previous_map: dict[str, dict] = {}
            for row in previous_rows:
                if row.get("is_deleted"):
                    continue
                key = _article_match_key(
                    row.get("article_type"),
                    row.get("lineage_id"),
                    row.get("legal_number"),
                    row.get("title"),
                )
                if key is not None:
                    previous_map[key] = row

            rows: list[tuple[str, str, str]] = []
            seen_keys: set[str] = set()

            for article in current_rows:
                if article.is_deleted:
                    continue
                key = _article_match_key(
                    article.article_type,
                    article.lineage_id,
                    article.legal_number,
                    article.title,
                )
                if key is None:
                    continue
                seen_keys.add(key)
                prev = previous_map.get(key)
                content_text = " ".join((article.content or "").split()) or "（無內容）"
                article_no = f"第 {article.legal_number or article.title or '?'} 條"
                if prev is None:
                    status = "新增"
                elif (prev.get("content") or "").strip() != (article.content or "").strip() or (
                    prev.get("title") or ""
                ).strip() != (article.title or "").strip():
                    status = "修正"
                elif (prev.get("legal_number") or "") != (article.legal_number or ""):
                    # 內容相同但條號變動 → 條次調整，於對照表標示原條號
                    status = "條次調整"
                    old_no = prev.get("legal_number") or prev.get("title") or "?"
                    article_no = f"第 {article.legal_number or '?'} 條（原第 {old_no} 條）"
                else:
                    continue
                rows.append((status, article_no, content_text))

            for key, row in previous_map.items():
                if key in seen_keys:
                    continue
                rows.append(
                    (
                        "刪除",
                        f"第 {row.get('legal_number') or row.get('title') or '?'} 條",
                        " ".join((row.get("content") or "").split()) or "（原內容）",
                    )
                )

            if not rows:
                return "（本次未偵測到條文內容異動）"

            status_width = max(4, max(len(status) for status, _, _ in rows))
            article_width = max(10, max(len(article_no) for _, article_no, _ in rows))
            header = f"{'異動':<{status_width}}  {'條號':<{article_width}}  內容"
            rule = f"{'─' * status_width}  {'─' * article_width}  {'─' * 24}"
            body_lines = [
                f"{status:<{status_width}}  {article_no:<{article_width}}  {content}"
                for status, article_no, content in rows
            ]
            return "\n".join([header, rule, *body_lines])

        # 1. 取得前一版修訂快照供比對
        prev_snapshot_result = await session.execute(
            _sel(RegulationRevision)
            .where(RegulationRevision.regulation_id == reg.id)
            .order_by(RegulationRevision.version.desc())
            .limit(1)
        )
        prev_rev = prev_snapshot_result.scalar_one_or_none()

        # 2. 流程狀態轉換
        await reg_svc.transition_workflow(
            session,
            reg,
            to_status=RegulationWorkflowStatus.PUBLISHED,
            actor_id=current_user.id,
            note=payload.note,
        )

        # 3. published_at + 修訂快照
        now = datetime.now(UTC)
        reg.published_at = now
        previous_article_snapshot = (
            json.loads(prev_rev.article_snapshot or "[]")
            if prev_rev and prev_rev.article_snapshot
            else []
        )
        amendment_body = _build_amendment_body(previous_article_snapshot, reg.articles)
        rev = RegulationRevision(
            regulation_id=reg.id,
            version=reg.version,
            change_brief=payload.note or "主席公布",
            is_total_amendment=(prev_rev is None),
            content_snapshot=reg.content,
            article_snapshot=reg_svc._article_snapshot_json(reg.articles),
            proposal_metadata_snapshot=reg.proposal_metadata,
            amended_at=now,
            amended_by=current_user.id,
        )
        # 用 reg.revisions.append 而非只 session.add：reg 在本次請求內已透過
        # _get_reg_or_404 selectinload 過 revisions，僅 session.add 不會反向同步
        # 這個已載入的 in-memory collection，會讓本次回應的 RegulationOut.revisions
        # 看不到剛建立的公布快照。
        reg.revisions.append(rev)
        await session.flush()

        # 4. 查詢主席公布專用字號模板；若前端指定模板，優先使用指定模板。
        tmpl_result = await session.execute(
            _sel(DocumentSerialTemplate)
            .where(DocumentSerialTemplate.is_active.is_(True))
            .order_by(
                DocumentSerialTemplate.is_default_president_publish.desc(),
                DocumentSerialTemplate.updated_at.desc(),
            )
        )
        templates = list(tmpl_result.scalars().all())

        def _pick_president_publish_template(
            candidates: list[DocumentSerialTemplate],
        ) -> DocumentSerialTemplate | None:
            tmpl = next((t for t in candidates if t.is_default_president_publish), None)
            if tmpl is not None:
                return tmpl
            tmpl = next(
                (
                    t
                    for t in candidates
                    if t.org_prefix.strip() == "嶺班" and t.category_char.strip() == "主公"
                ),
                None,
            )
            if tmpl is not None:
                return tmpl
            tmpl = next((t for t in candidates if t.category_char.strip() == "主公"), None)
            if tmpl is not None:
                return tmpl
            return next(
                (
                    t
                    for t in candidates
                    if "主公" in f"{t.org_prefix}{t.category_char}".replace(" ", "")
                ),
                None,
            )

        tmpl: DocumentSerialTemplate | None = None
        if payload.serial_template_id is not None:
            tmpl = next((t for t in templates if t.id == payload.serial_template_id), None)
            if tmpl is None:
                raise ValueError("指定的主席公布字號模板不存在或已停用")
            if tmpl.org_id != reg.org_id:
                raise ValueError("指定的主席公布字號模板不屬於此法規組織")
        elif not (payload.manual_serial_number or "").strip():
            tmpl = _pick_president_publish_template(templates)

        if tmpl is None and not (payload.manual_serial_number or "").strip():
            raise ValueError(
                "找不到可用的主席公布字號模板，請先到字號模板管理設定「主席公布預設模板」"
            )

        # 5. 公布令本文
        action_verb = "修正" if prev_rev else "制定"
        # change_desc：使用者填寫的條文說明（如「第七條」「第一條、第二條」）
        change_desc = (payload.note or "").strip()
        if change_desc:
            decree_line = f"茲{action_verb}《{reg.title}》{change_desc}，公布之。"
        else:
            decree_line = f"茲{action_verb}《{reg.title}》，公布之。"

        doc_body = f"{decree_line}\n\n修正條文整理：\n{amendment_body}"

        pub_doc_data = DocumentCreate(
            title=f"公布《{reg.title}》",
            org_id=tmpl.org_id if tmpl else reg.org_id,
            category=DocumentCategory.DECREE,
            urgency=DocumentUrgency.NORMAL,
            classification=DocumentClassification.NORMAL,
            subject=None,
            doc_description=doc_body,
            content=doc_body,
            handler_name=current_user.display_name,
            handler_unit="主席",
            serial_template_id=tmpl.id if tmpl else None,
            manual_serial_number=payload.manual_serial_number,
            visibility_level=DocumentVisibility.PUBLICLY_OPEN,
        )
        pub_doc = await doc_svc.create_document(
            session, data=pub_doc_data, created_by=current_user.id
        )
        pub_doc.regulation_id = reg.id
        pub_doc.regulation_revision_id = rev.id
        rev.published_document = pub_doc
        pub_doc = await doc_svc.issue_document_directly(
            session,
            pub_doc,
            issued_by=current_user.id,
            comment="主席公布法規自動發文",
        )
        reg.published_document_id = pub_doc.id

        # 取代來源法規：修正案（fork）正式公布後，原現行法規自動退場，
        # 避免法規列表同時出現「修正前」與「修正後」兩個版本。
        if reg.source_regulation_id is not None:
            source = await session.get(Regulation, reg.source_regulation_id)
            if (
                source is not None
                and source.id != reg.id
                and source.is_active
                and source.published_at is not None
            ):
                session.add(
                    RegulationWorkflowLog(
                        regulation_id=source.id,
                        from_status=source.workflow_status,
                        to_status=RegulationWorkflowStatus.ARCHIVED,
                        actor_id=current_user.id,
                        note=f"由修正版本《{reg.title}》v{reg.version} 取代",
                    )
                )
                source.is_active = False
                source.workflow_status = RegulationWorkflowStatus.ARCHIVED
                source.repeal_replacement_id = reg.id

        await session.flush()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.workflow_published",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "note": payload.note,
            "published_document_id": str(reg.published_document_id)
            if reg.published_document_id
            else None,
        },
        summary=f"主席公布法規「{reg.title}」",
    )
    try:
        from api.services.outbox import emit as outbox_emit

        await outbox_emit(
            session,
            event_type="regulation.published",
            payload={
                "regulation_id": str(reg.id),
                "regulation_title": reg.title,
                "org_id": str(reg.org_id),
                "actor_id": str(current_user.id),
                "actor_email": current_user.email or "",
            },
        )
    except Exception:
        logger.warning("emit regulation.published failed", exc_info=True)
    await invalidate_cache(reg.org_id)
    return reg
