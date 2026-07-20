"""校商投稿 Router。"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.email.sender import send_branded_email
from api.models.merchandise_submission import MerchandiseSubmissionStatus
from api.models.user import User
from api.routers._common import or_404
from api.schemas.merchandise_submission import (
    MerchandiseSubmissionAdminListItem,
    MerchandiseSubmissionItemCreate,
    MerchandiseSubmissionItemOut,
    MerchandiseSubmissionItemUpdate,
    MerchandiseSubmissionOut,
    MerchandiseSubmissionPortalOut,
    MerchandiseSubmissionReview,
    MerchandiseSubmissionSave,
    MerchandiseSubmissionSettingsOut,
    MerchandiseSubmissionSettingsUpdate,
    MerchandiseSubmissionUploadOut,
)
from api.services import audit as audit_svc
from api.services import merchandise_submission as submission_svc
from api.services.permission import get_user_permission_codes
from api.services.storage import get_storage

router = APIRouter(prefix="/merchandise-submissions", tags=["校商投稿"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]

logger = logging.getLogger(__name__)

_REVIEW_STATUS_LABELS = {
    MerchandiseSubmissionStatus.REVIEWING: "進入審核",
    MerchandiseSubmissionStatus.APPROVED: "已採用",
    MerchandiseSubmissionStatus.REVISION_REQUESTED: "需要補件",
    MerchandiseSubmissionStatus.REJECTED: "未採用",
}


def _upload_preview_url(storage_key: str) -> str:
    return f"/merchandise-submissions/uploads/{storage_key}"


def _notify_review_result_by_email(submission) -> None:
    status_label = _REVIEW_STATUS_LABELS.get(submission.status, str(submission.status))
    note = submission.review_note or "請前往校商投稿頁查看最新狀態。"
    send_branded_email(
        to=[submission.user.email],
        subject=f"【校商投稿】「{submission.item.name}」審核結果：{status_label}",
        template="notification",
        context={
            "heading": f"您的投稿{status_label}",
            "body_text": (
                f"您投稿的「{submission.item.name}」審核狀態已更新為「{status_label}」。\n\n"
                f"審核備註：{note}"
            ),
            "preview_text": f"校商投稿「{submission.item.name}」{status_label}",
            "cta_url": f"{settings.FRONTEND_BASE_URL.rstrip('/')}/merchandise-submissions",
            "cta_label": "前往查看投稿",
        },
    )


def _serialize_submission(submission, *, include_submitter: bool):
    payload = {
        "id": submission.id,
        "item_id": submission.item_id,
        "item_name": submission.item.name,
        "status": submission.status,
        "account_snapshot": submission.account_snapshot,
        "field_values": submission.field_values,
        "files": [
            {
                "id": file.id,
                "storage_key": file.storage_key,
                "filename": file.filename,
                "content_type": file.content_type,
                "file_size": file.file_size,
                "url": _upload_preview_url(file.storage_key),
            }
            for file in submission.files
        ],
        "submitted_at": submission.submitted_at,
        "reviewed_at": submission.reviewed_at,
        "reviewer_name": submission.reviewer.display_name if submission.reviewer else None,
        "review_note": submission.review_note,
        "created_at": submission.created_at,
        "updated_at": submission.updated_at,
    }
    if include_submitter:
        payload.update(
            {
                "submitter_name": submission.user.display_name,
                "submitter_email": submission.user.email,
                "submitter_student_id": submission.user.student_id,
            }
        )
    return payload


@router.get("/portal", response_model=MerchandiseSubmissionPortalOut, summary="取得投稿入口資料")
async def portal(session: DbDep, current_user: CurrentUser) -> dict:
    settings = await submission_svc.get_settings(session)
    items = await submission_svc.list_items(session, include_inactive=False)
    result = []
    for item in items:
        accepting, opens_at, closes_at, max_mb = submission_svc.effective_config(settings, item)
        item_payload = MerchandiseSubmissionItemOut.model_validate(item).model_dump()
        item_payload["custom_fields"] = submission_svc.effective_custom_fields(settings, item)
        result.append(
            {
                **item_payload,
                "is_accepting": accepting,
                "effective_opens_at": opens_at,
                "effective_closes_at": closes_at,
                "effective_max_file_size_mb": max_mb,
            }
        )
    return {
        "settings": settings,
        "items": result,
        "is_eligible_submitter": submission_svc.can_submit(settings, current_user),
    }


@router.get("/submissions/me", response_model=list[MerchandiseSubmissionOut], summary="我的投稿")
async def my_submissions(session: DbDep, current_user: CurrentUser) -> list[dict]:
    submissions = await submission_svc.list_my_submissions(session, user_id=current_user.id)
    return [
        _serialize_submission(submission, include_submitter=False) for submission in submissions
    ]


@router.post("/uploads", response_model=MerchandiseSubmissionUploadOut, summary="上傳投稿圖稿")
async def upload_submission_file(
    item_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> MerchandiseSubmissionUploadOut:
    item = or_404(await submission_svc.get_item(session, item_id), "找不到投稿品項")
    settings = await submission_svc.get_settings(session)
    try:
        submission_svc.require_eligible_submitter(settings, current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    accepting, _, _, max_mb = submission_svc.effective_config(settings, item)
    if not accepting:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="此品項目前未開放投稿")
    storage = get_storage()
    allowed_types = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
    try:
        stored = await storage.save(
            file,
            prefix=f"merchandise-submissions/{current_user.id}",
            max_file_size=max_mb * 1024 * 1024,
            allowed_content_types=allowed_types,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return MerchandiseSubmissionUploadOut(
        storage_key=stored.storage_key,
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
        url=_upload_preview_url(stored.storage_key),
    )


@router.get("/uploads/{storage_key:path}", summary="預覽投稿圖稿")
async def preview_submission_file(storage_key: str, session: DbDep, current_user: CurrentUser):
    own_prefix = f"merchandise-submissions/{current_user.id}/"
    stored_file = await submission_svc.get_submission_file(session, storage_key)
    if stored_file is None:
        if not storage_key.startswith(own_prefix):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權檢視此投稿圖稿")
        filename = None
        content_type = None
    else:
        is_owner = stored_file.submission.user_id == current_user.id
        if not is_owner and not current_user.is_superuser:
            codes = await get_user_permission_codes(session, current_user.id)
            if str(PermissionCode.SHOP_MANAGE) not in codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="無權檢視此投稿圖稿"
                )
        filename = stored_file.filename
        content_type = stored_file.content_type

    storage = get_storage()
    local_path = storage.local_path(storage_key)
    if local_path is not None:
        if not local_path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到投稿圖稿")
        return FileResponse(
            local_path,
            media_type=content_type,
            filename=filename,
            content_disposition_type="inline",
        )
    return RedirectResponse(
        await storage.get_url(storage_key, disposition="inline", download_name=filename)
    )


@router.post(
    "/submissions", response_model=MerchandiseSubmissionOut, status_code=status.HTTP_201_CREATED
)
async def create_submission(
    payload: MerchandiseSubmissionSave,
    session: DbDep,
    current_user: CurrentUser,
    submit: bool = Query(True),
) -> dict:
    try:
        submission = await submission_svc.save_submission(
            session, payload, user=current_user, submit=submit
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        session,
        entity_type="merchandise_submission",
        entity_id=str(submission.id),
        action="merchandise_submission.submit" if submit else "merchandise_submission.save_draft",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"item_id": str(submission.item_id), "status": submission.status.value},
        summary=f"{'送出' if submit else '儲存'}校商投稿「{submission.item.name}」",
    )
    return _serialize_submission(submission, include_submitter=False)


@router.patch("/submissions/{submission_id}", response_model=MerchandiseSubmissionOut)
async def update_my_submission(
    submission_id: uuid.UUID,
    payload: MerchandiseSubmissionSave,
    session: DbDep,
    current_user: CurrentUser,
    submit: bool = Query(True),
) -> dict:
    submission = or_404(await submission_svc.get_submission(session, submission_id), "找不到投稿")
    try:
        submission = await submission_svc.update_submission(
            session, submission, payload, user=current_user, submit=submit
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        session,
        entity_type="merchandise_submission",
        entity_id=str(submission.id),
        action="merchandise_submission.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"status": submission.status.value},
        summary=f"更新校商投稿「{submission.item.name}」",
    )
    return _serialize_submission(submission, include_submitter=False)


@router.get(
    "/admin/settings",
    response_model=MerchandiseSubmissionSettingsOut,
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def admin_settings(session: DbDep, _: CurrentUser):
    return await submission_svc.get_settings(session)


@router.patch(
    "/admin/settings",
    response_model=MerchandiseSubmissionSettingsOut,
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def update_admin_settings(
    payload: MerchandiseSubmissionSettingsUpdate, session: DbDep, current_user: CurrentUser
):
    settings = await submission_svc.get_settings(session)
    try:
        return await submission_svc.update_settings(
            session, settings, payload, updated_by_id=current_user.id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.post(
    "/admin/template-images",
    response_model=MerchandiseSubmissionUploadOut,
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def upload_template_image(
    _: CurrentUser, file: UploadFile = File(...)
) -> MerchandiseSubmissionUploadOut:
    storage = get_storage()
    try:
        stored = await storage.save(
            file,
            prefix="merchandise-submissions/templates",
            max_file_size=20 * 1024 * 1024,
            allowed_content_types={"image/jpeg", "image/png", "image/webp"},
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return MerchandiseSubmissionUploadOut(
        storage_key=stored.storage_key,
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
        url=stored.url,
    )


@router.get(
    "/admin/items",
    response_model=list[MerchandiseSubmissionItemOut],
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def admin_items(session: DbDep, _: CurrentUser):
    return await submission_svc.list_items(session, include_inactive=True)


@router.post(
    "/admin/items",
    response_model=MerchandiseSubmissionItemOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def create_admin_item(
    payload: MerchandiseSubmissionItemCreate, session: DbDep, current_user: CurrentUser
):
    try:
        return await submission_svc.create_item(session, payload, created_by_id=current_user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.patch(
    "/admin/items/{item_id}",
    response_model=MerchandiseSubmissionItemOut,
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def update_admin_item(
    item_id: uuid.UUID,
    payload: MerchandiseSubmissionItemUpdate,
    session: DbDep,
    _: CurrentUser,
):
    item = or_404(await submission_svc.get_item(session, item_id), "找不到投稿品項")
    try:
        return await submission_svc.update_item(session, item, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get(
    "/admin/submissions",
    response_model=list[MerchandiseSubmissionAdminListItem],
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def admin_submissions(
    session: DbDep,
    _: CurrentUser,
    status_filter: MerchandiseSubmissionStatus | None = Query(None, alias="status"),
) -> list[dict]:
    submissions = await submission_svc.list_submissions(session, status=status_filter)
    return [_serialize_submission(submission, include_submitter=True) for submission in submissions]


@router.patch(
    "/admin/submissions/{submission_id}/review",
    response_model=MerchandiseSubmissionAdminListItem,
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def review_admin_submission(
    submission_id: uuid.UUID,
    payload: MerchandiseSubmissionReview,
    session: DbDep,
    current_user: CurrentUser,
) -> dict:
    submission = or_404(await submission_svc.get_submission(session, submission_id), "找不到投稿")
    try:
        submission = await submission_svc.review_submission(
            session, submission, payload, reviewer_id=current_user.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    from api.routers.notifications import create_notification

    if submission.user.email:
        try:
            _notify_review_result_by_email(submission)
        except Exception:
            logger.warning(
                "校商投稿審核結果 Email 排程失敗 submission=%s user=%s",
                submission.id,
                submission.user_id,
                exc_info=True,
            )

    await create_notification(
        session,
        user_id=submission.user_id,
        type="system",
        title=f"校商投稿「{submission.item.name}」已有審核結果",
        body=submission.review_note or "請前往投稿頁查看最新狀態。",
        link="/merchandise-submissions",
        related_id=submission.id,
    )
    await audit_svc.record(
        session,
        entity_type="merchandise_submission",
        entity_id=str(submission.id),
        action="merchandise_submission.review",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"status": submission.status.value},
        summary=f"審核校商投稿「{submission.item.name}」",
    )
    return _serialize_submission(submission, include_submitter=True)
