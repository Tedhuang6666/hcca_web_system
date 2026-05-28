"""段考題庫端點。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.exam_paper import ExamGradeTrack, ExamPaper, ExamPaperDownload
from api.models.user import User
from api.schemas.exam_paper import (
    ExamPaperDownloadOut,
    ExamPaperListItem,
    ExamPaperOut,
    ExamPaperUpdate,
    ExamTraceInspectMatch,
    ExamTraceInspectOut,
)
from api.services import audit as audit_svc
from api.services import exam_paper as exam_svc

router = APIRouter(prefix="/exam-papers", tags=["段考題庫"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


async def _paper_or_404(session: AsyncSession, paper_id: uuid.UUID) -> ExamPaper:
    paper = await exam_svc.get_paper(session, paper_id)
    if paper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此段考題")
    return paper


async def _assert_school_or_download(session: AsyncSession, user: User) -> None:
    if not await exam_svc.can_download_exam_papers(session, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="僅限校內成員下載")


@router.get("", response_model=list[ExamPaperListItem], summary="列出段考題")
async def list_exam_papers(
    session: DbDep,
    current_user: CurrentUser,
    include_unpublished: bool = Query(False),
    subject: str | None = Query(None),
    academic_year: int | None = Query(None, ge=1, le=999),
    semester: int | None = Query(None, ge=1, le=2),
    grade: int | None = Query(None, ge=1, le=3),
    grade_track: ExamGradeTrack | None = Query(None),
    exam_number: int | None = Query(None, ge=1, le=4),
) -> list[ExamPaper]:
    can_manage = await exam_svc.can_manage_exam_papers(session, current_user)
    if include_unpublished and not can_manage:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：exam:manage")
    if not can_manage:
        await _assert_school_or_download(session, current_user)
    return await exam_svc.list_papers(
        session,
        include_unpublished=include_unpublished and can_manage,
        subject=subject,
        academic_year=academic_year,
        semester=semester,
        grade=grade,
        grade_track=grade_track,
        exam_number=exam_number,
    )


@router.post(
    "",
    response_model=ExamPaperOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳段考題 PDF（exam:manage）",
    dependencies=[Depends(require_permission(PermissionCode.EXAM_MANAGE))],
)
async def create_exam_paper(
    session: DbDep,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1, max_length=200),
    subject: str = Form(..., min_length=1, max_length=80),
    academic_year: int = Form(..., ge=1, le=999),
    semester: int = Form(..., ge=1, le=2),
    grade: int = Form(..., ge=1, le=3),
    grade_track: ExamGradeTrack | None = Form(None),
    exam_number: int = Form(..., ge=1, le=4),
    is_published: bool = Form(False),
) -> ExamPaper:
    try:
        paper = await exam_svc.create_paper(
            session,
            file=file,
            title=title,
            subject=subject,
            academic_year=academic_year,
            semester=semester,
            grade=grade,
            grade_track=grade_track,
            exam_number=exam_number,
            is_published=is_published,
            uploaded_by=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    await audit_svc.record(
        session,
        entity_type="exam_paper",
        entity_id=str(paper.id),
        action="exam_paper.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"title": paper.title, "subject": paper.subject, "is_published": paper.is_published},
        summary=f"上傳段考題「{paper.title}」",
    )
    return paper


@router.patch(
    "/{paper_id}",
    response_model=ExamPaperOut,
    summary="更新段考題 metadata（exam:manage）",
    dependencies=[Depends(require_permission(PermissionCode.EXAM_MANAGE))],
)
async def update_exam_paper(
    paper_id: uuid.UUID,
    payload: ExamPaperUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ExamPaper:
    paper = await _paper_or_404(session, paper_id)
    old_published = paper.is_published
    try:
        paper = await exam_svc.update_paper(session, paper, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        session,
        entity_type="exam_paper",
        entity_id=str(paper.id),
        action="exam_paper.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "values": payload.model_dump(exclude_unset=True, mode="json"),
            "old_is_published": old_published,
        },
        summary=f"更新段考題「{paper.title}」",
    )
    return paper


@router.post(
    "/trace/inspect",
    response_model=ExamTraceInspectOut,
    summary="上傳疑似外流檔案並自動判斷追蹤碼（exam:manage）",
    dependencies=[Depends(require_permission(PermissionCode.EXAM_MANAGE))],
)
async def inspect_exam_trace(session: DbDep, file: UploadFile = File(...)) -> ExamTraceInspectOut:
    try:
        codes, downloads, unsupported = await exam_svc.inspect_trace_file(session, file=file)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    matches = [
        ExamTraceInspectMatch(
            trace_code=row.trace_code,
            download_id=row.id,
            paper_id=row.paper_id,
            paper_title=row.paper.title if row.paper else "",
            user_id=row.user_id,
            user_display_name=row.user.display_name if row.user else "",
            user_email=row.user.email if row.user else "",
            user_student_id=row.user.student_id if row.user else None,
            downloaded_at=row.downloaded_at,
            confidence="high",
        )
        for row in downloads
    ]
    return ExamTraceInspectOut(
        detected_trace_codes=codes,
        matches=matches,
        unsupported_reason=unsupported,
    )


@router.delete(
    "/{paper_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除段考題（exam:manage）",
    dependencies=[Depends(require_permission(PermissionCode.EXAM_MANAGE))],
)
async def delete_exam_paper(paper_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    paper = await _paper_or_404(session, paper_id)
    await exam_svc.soft_delete_paper(session, paper)
    await audit_svc.record(
        session,
        entity_type="exam_paper",
        entity_id=str(paper.id),
        action="exam_paper.delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"title": paper.title},
        summary=f"刪除段考題「{paper.title}」",
    )


@router.get(
    "/{paper_id}/download",
    summary="下載帶個人化追蹤標籤的段考題 PDF",
)
async def download_exam_paper(
    paper_id: uuid.UUID,
    request: Request,
    session: DbDep,
    current_user: CurrentUser,
) -> Response:
    paper = await _paper_or_404(session, paper_id)
    can_manage = await exam_svc.can_manage_exam_papers(session, current_user)
    if not paper.is_published and not can_manage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此段考題")
    if not can_manage:
        await _assert_school_or_download(session, current_user)

    try:
        pdf_bytes, filename, download = await exam_svc.build_traced_pdf(
            session,
            paper=paper,
            user=current_user,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    await audit_svc.record(
        session,
        entity_type="exam_paper",
        entity_id=str(paper.id),
        action="exam_paper.download",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"trace_code": download.trace_code, "file_sha256": download.file_sha256},
        ip_address=request.client.host if request.client else None,
        summary=f"下載段考題「{paper.title}」追蹤碼 {download.trace_code}",
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": exam_svc.content_disposition(filename)},
    )


@router.get(
    "/{paper_id}/downloads",
    response_model=list[ExamPaperDownloadOut],
    summary="查看段考題下載紀錄（exam:manage）",
    dependencies=[Depends(require_permission(PermissionCode.EXAM_MANAGE))],
)
async def list_exam_paper_downloads(
    paper_id: uuid.UUID, session: DbDep, _: CurrentUser
) -> list[ExamPaperDownload]:
    await _paper_or_404(session, paper_id)
    return await exam_svc.list_downloads(session, paper_id)
