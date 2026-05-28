"""段考題庫業務邏輯。"""

from __future__ import annotations

import hashlib
import html
import io
import re
import secrets
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import UploadFile
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings
from api.core.permission_codes import PermissionCode
from api.models.exam_paper import ExamGradeTrack, ExamPaper, ExamPaperDownload
from api.models.user import User
from api.schemas.exam_paper import ExamPaperUpdate
from api.services.official_print import render_print_pdf
from api.services.permission import get_user_permission_codes
from api.services.storage import get_storage

_PDF_CONTENT_TYPE = "application/pdf"


def is_school_member(user: User) -> bool:
    """校內成員：有學號，或 email 屬允許登入的校內網域。"""
    if user.student_id:
        return True
    normalized = user.email.strip().lower()
    domain = normalized.rsplit("@", maxsplit=1)[-1] if "@" in normalized else ""
    return domain in settings.LOGIN_ALLOWED_EMAIL_DOMAINS


async def can_manage_exam_papers(session: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(session, user.id)
    return PermissionCode.ADMIN_ALL in codes or PermissionCode.EXAM_MANAGE in codes


async def can_download_exam_papers(session: AsyncSession, user: User) -> bool:
    if is_school_member(user) or await can_manage_exam_papers(session, user):
        return True
    codes = await get_user_permission_codes(session, user.id)
    return PermissionCode.EXAM_DOWNLOAD in codes


async def list_papers(
    session: AsyncSession,
    *,
    include_unpublished: bool,
    subject: str | None = None,
    academic_year: int | None = None,
    semester: int | None = None,
    grade: int | None = None,
    grade_track: ExamGradeTrack | None = None,
    exam_number: int | None = None,
) -> list[ExamPaper]:
    stmt = select(ExamPaper).where(ExamPaper.is_active.is_(True))
    if not include_unpublished:
        stmt = stmt.where(ExamPaper.is_published.is_(True))
    if subject:
        stmt = stmt.where(ExamPaper.subject == subject)
    if academic_year is not None:
        stmt = stmt.where(ExamPaper.academic_year == academic_year)
    if semester is not None:
        stmt = stmt.where(ExamPaper.semester == semester)
    if grade is not None:
        stmt = stmt.where(ExamPaper.grade == grade)
    if grade_track is not None:
        stmt = stmt.where(ExamPaper.grade_track == grade_track)
    if exam_number is not None:
        stmt = stmt.where(ExamPaper.exam_number == exam_number)
    stmt = stmt.order_by(
        ExamPaper.academic_year.desc(),
        ExamPaper.semester.desc(),
        ExamPaper.grade,
        ExamPaper.grade_track,
        ExamPaper.subject,
        ExamPaper.exam_number,
        ExamPaper.created_at.desc(),
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_paper(session: AsyncSession, paper_id: uuid.UUID) -> ExamPaper | None:
    result = await session.execute(
        select(ExamPaper).where(ExamPaper.id == paper_id, ExamPaper.is_active.is_(True))
    )
    return result.scalar_one_or_none()


async def create_paper(
    session: AsyncSession,
    *,
    file: UploadFile,
    title: str,
    subject: str,
    academic_year: int,
    semester: int,
    grade: int,
    exam_number: int,
    grade_track: ExamGradeTrack | None,
    is_published: bool,
    uploaded_by: uuid.UUID,
) -> ExamPaper:
    if (file.content_type or "").lower() != _PDF_CONTENT_TYPE and not (
        file.filename or ""
    ).lower().endswith(".pdf"):
        msg = "僅支援 PDF 檔案"
        raise ValueError(msg)
    _validate_grade_track(grade, grade_track)

    storage = get_storage()
    stored = await storage.save(file, prefix="exam-papers")
    if stored.content_type != _PDF_CONTENT_TYPE:
        await storage.delete(stored.storage_key)
        msg = "僅支援 PDF 檔案"
        raise ValueError(msg)

    paper = ExamPaper(
        title=title.strip(),
        subject=subject.strip(),
        academic_year=academic_year,
        semester=semester,
        grade=grade,
        grade_track=grade_track,
        exam_number=exam_number,
        filename=stored.filename,
        storage_key=stored.storage_key,
        content_type=stored.content_type,
        file_size=stored.file_size,
        is_published=is_published,
        uploaded_by=uploaded_by,
    )
    session.add(paper)
    await session.flush()
    return paper


async def update_paper(session: AsyncSession, paper: ExamPaper, data: ExamPaperUpdate) -> ExamPaper:
    values = data.model_dump(exclude_unset=True)
    for key, value in values.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(paper, key, value)
    _validate_grade_track(paper.grade, paper.grade_track)
    await session.flush()
    return paper


def _validate_grade_track(grade: int, grade_track: ExamGradeTrack | None) -> None:
    if grade == 1 and grade_track is not None:
        msg = "高一不分一二三類組"
        raise ValueError(msg)
    if grade in {2, 3} and grade_track is None:
        msg = "高二、高三需選擇一類、二類或三類"
        raise ValueError(msg)


async def soft_delete_paper(session: AsyncSession, paper: ExamPaper) -> None:
    paper.is_active = False
    paper.is_published = False
    await session.flush()


async def list_downloads(session: AsyncSession, paper_id: uuid.UUID) -> list[ExamPaperDownload]:
    result = await session.execute(
        select(ExamPaperDownload)
        .options(selectinload(ExamPaperDownload.user))
        .where(ExamPaperDownload.paper_id == paper_id)
        .order_by(ExamPaperDownload.downloaded_at.desc())
    )
    rows = list(result.scalars().all())
    for row in rows:
        row.__dict__["user_display_name"] = row.user.display_name if row.user else ""
        row.__dict__["user_email"] = row.user.email if row.user else ""
        row.__dict__["user_student_id"] = row.user.student_id if row.user else None
    return rows


def _trace_code(now: datetime) -> str:
    return f"EX-{now:%Y%m%d}-{secrets.token_urlsafe(6).replace('-', '').replace('_', '')[:8]}"


def _source_pdf_bytes(paper: ExamPaper) -> bytes:
    path = Path(settings.STORAGE_LOCAL_DIR) / paper.storage_key
    if not path.exists():
        msg = "找不到題目原始檔"
        raise FileNotFoundError(msg)
    return path.read_bytes()


def _identity_label(user: User) -> str:
    token = user.student_id or user.email
    return f"{user.display_name} / {token}"


def _overlay_pdf(width: float, height: float, label: str, footer: str, page_code: str) -> bytes:
    label_html = html.escape(label)
    footer_html = html.escape(footer)
    page_code_html = html.escape(page_code)
    return render_print_pdf(
        f"""<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <style>
    @page {{ size: {width}pt {height}pt; margin: 0; }}
    html, body {{ margin: 0; width: {width}pt; height: {height}pt; }}
    body {{ position: relative; font-family: sans-serif; color: rgba(120, 20, 20, 0.18); }}
    .mark {{
      position: absolute;
      left: 8%;
      top: 44%;
      width: 84%;
      text-align: center;
      transform: rotate(-28deg);
      font-size: 24pt;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }}
    .corner {{
      position: absolute;
      color: rgba(0, 0, 0, 0.5);
      font-size: 5.5pt;
      letter-spacing: .02em;
    }}
    .tl {{ left: 8pt; top: 8pt; }}
    .tr {{ right: 8pt; top: 8pt; }}
    .bl {{ left: 8pt; bottom: 8pt; }}
    .br {{ right: 8pt; bottom: 8pt; }}
    .hairline {{
      position: absolute;
      left: 14pt;
      right: 14pt;
      top: 50%;
      color: rgba(255, 255, 255, 0.35);
      font-size: 4pt;
      text-align: center;
    }}
    .footer {{
      position: absolute;
      left: 18pt;
      right: 18pt;
      bottom: 11pt;
      color: rgba(0, 0, 0, 0.55);
      font-size: 7.5pt;
      text-align: center;
      overflow-wrap: anywhere;
    }}
  </style>
</head>
<body>
  <div class="mark">{label_html}</div>
  <div class="corner tl">{page_code_html}</div>
  <div class="corner tr">{page_code_html}</div>
  <div class="corner bl">{page_code_html}</div>
  <div class="corner br">{page_code_html}</div>
  <div class="hairline">{page_code_html} {footer_html}</div>
  <div class="footer">{footer_html}</div>
</body>
</html>"""
    )


def _download_filename(paper: ExamPaper, trace_code: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in paper.title).strip("_")
    return f"{safe or 'exam_paper'}_{trace_code}.pdf"


async def build_traced_pdf(
    session: AsyncSession,
    *,
    paper: ExamPaper,
    user: User,
    ip_address: str | None,
    user_agent: str | None,
) -> tuple[bytes, str, ExamPaperDownload]:
    now = datetime.now(UTC)
    trace_code = _trace_code(now)
    download = ExamPaperDownload(
        paper_id=paper.id,
        user_id=user.id,
        trace_code=trace_code,
        ip_address=ip_address,
        user_agent=user_agent,
        downloaded_at=now,
    )
    session.add(download)
    await session.flush()

    source = _source_pdf_bytes(paper)
    try:
        reader = PdfReader(io.BytesIO(source))
    except PdfReadError as exc:
        msg = "題目 PDF 無法讀取"
        raise ValueError(msg) from exc

    writer = PdfWriter()
    downloaded_at = now.astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    identity = _identity_label(user)
    footer = f"HCCA Trace {trace_code} | {user.student_id or user.email} | {downloaded_at}"

    for index, page in enumerate(reader.pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        page_code = f"{trace_code}-P{index:03d}"
        overlay_reader = PdfReader(
            io.BytesIO(_overlay_pdf(width, height, identity, footer, page_code))
        )
        page.merge_page(overlay_reader.pages[0])
        writer.add_page(page)

    writer.add_metadata(
        {
            "/Title": paper.title,
            "/Subject": f"HCCA Exam Paper Trace {trace_code}",
            "/Keywords": f"{trace_code};{user.id};{user.student_id or user.email}",
            "/Producer": f"HCCA Campus Self-Governance Platform {trace_code}",
        }
    )

    output = io.BytesIO()
    writer.write(output)
    pdf_bytes = output.getvalue()
    download.file_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    await session.flush()
    return pdf_bytes, _download_filename(paper, trace_code), download


def content_disposition(filename: str) -> str:
    return f"attachment; filename*=UTF-8''{quote(filename.encode('utf-8'))}"


_TRACE_RE = re.compile(r"EX-\d{8}-[A-Za-z0-9]{6,16}")


def _extract_trace_codes_from_pdf(file_bytes: bytes) -> set[str]:
    codes: set[str] = set(_TRACE_RE.findall(file_bytes.decode("latin1", errors="ignore")))
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
    except PdfReadError:
        return codes
    metadata = reader.metadata or {}
    for value in metadata.values():
        if value:
            codes.update(_TRACE_RE.findall(str(value)))
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        codes.update(_TRACE_RE.findall(text))
    return codes


async def inspect_trace_file(
    session: AsyncSession,
    *,
    file: UploadFile,
) -> tuple[list[str], list[ExamPaperDownload], str | None]:
    content = await file.read(20 * 1024 * 1024 + 1)
    if len(content) > 20 * 1024 * 1024:
        msg = "檔案超過最大限制 20 MB"
        raise ValueError(msg)
    content_type = (file.content_type or "").lower()
    filename = (file.filename or "").lower()
    if content_type == _PDF_CONTENT_TYPE or filename.endswith(".pdf"):
        codes = sorted(_extract_trace_codes_from_pdf(content))
        unsupported = None
    elif content_type.startswith("image/") or filename.endswith((".jpg", ".jpeg", ".png", ".webp")):
        codes = sorted(set(_TRACE_RE.findall(content.decode("latin1", errors="ignore"))))
        unsupported = "照片尚未接入 OCR；若畫面可見追蹤碼，請人工輸入或上傳原始 PDF。"
    else:
        codes = sorted(set(_TRACE_RE.findall(content.decode("latin1", errors="ignore"))))
        unsupported = "此檔案類型僅能做二進位文字掃描；PDF 可自動讀取 metadata 與頁面文字。"
    if not codes:
        return [], [], unsupported
    result = await session.execute(
        select(ExamPaperDownload)
        .options(selectinload(ExamPaperDownload.user), selectinload(ExamPaperDownload.paper))
        .where(ExamPaperDownload.trace_code.in_(codes))
    )
    return codes, list(result.scalars().all()), unsupported
