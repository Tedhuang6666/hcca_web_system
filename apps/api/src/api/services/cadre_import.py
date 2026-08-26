"""新竹高中班聯會幹部通訊錄一鍵匯入。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_invalidate_user_permissions
from api.models.org import Org, Permission, Position, PositionCategory, UserPosition
from api.models.person import PersonAffiliationKind, PersonAffiliationSource
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.schemas.cadre_import import CadreDirectoryImportOut
from api.services import person as person_svc
from api.services import school_class_import as class_import_svc
from api.services import user_registration as user_registration_svc


@dataclass(frozen=True)
class CadreAssignment:
    department: str
    position: str
    display_name: str
    is_leader: bool = False


_ROOT_ORG_NAMES = ("班級聯合自治會", "班聯會", "國立新竹高級中學班級聯合自治會")
_CADRE_ASSIGNMENTS = (
    CadreAssignment("秘書處", "秘書長", "簡子皓", True),
    CadreAssignment("秘書處", "秘書", "黃柏硯"),
    CadreAssignment("學權部", "學權長", "黃言真", True),
    CadreAssignment("活動部", "活動長", "邱翊展", True),
    CadreAssignment("活動部", "活動", "王愷瑋"),
    CadreAssignment("活動部", "活動", "黃言真"),
    CadreAssignment("活動部", "活動", "卓柏翰"),
    CadreAssignment("活動部", "活動", "張軒睿"),
    CadreAssignment("活動部", "活動", "劉修諺"),
    CadreAssignment("活動部", "活動", "羅亦承"),
    CadreAssignment("公關部", "公關長", "江華洋", True),
    CadreAssignment("公關部", "公關", "卓柏翰"),
    CadreAssignment("公關部", "公關", "陳泓毅"),
    CadreAssignment("公關部", "公關", "簡子皓"),
    CadreAssignment("公關部", "公關", "劉修諺"),
    CadreAssignment("財務部", "財務長", "鄭世懋", True),
    CadreAssignment("財務部", "財務", "趙奕杰"),
    CadreAssignment("新聞部", "新聞長", "張軒睿", True),
    CadreAssignment("設計部", "設計長", "彭羿齊", True),
    CadreAssignment("設計部", "設計", "陳定波"),
    CadreAssignment("攝影部", "攝影長", "林子皓", True),
    CadreAssignment("攝影部", "攝影", "張育祥"),
    CadreAssignment("攝影部", "攝影", "吳光晨"),
    CadreAssignment("攝影部", "攝影", "簡子皓"),
    CadreAssignment("資訊部", "資訊長", "陳旻佑", True),
    CadreAssignment("資訊部", "資訊", "劉懷鈞"),
    CadreAssignment("資訊部", "資訊", "王愷瑋"),
    CadreAssignment("資訊部", "資訊", "陳定波"),
)

_ROLE_PERMISSION_CODES: dict[tuple[str, str], tuple[str, ...]] = {
    ("秘書處", "秘書長"): (
        "org:manage_members",
        "org:view_members",
        "document:create",
        "document:draft",
        "document:edit",
        "document:submit",
        "meeting:create",
        "meeting:manage",
        "meeting:chair",
        "email:send",
        "email:send_bulk",
    ),
    ("秘書處", "秘書"): (
        "org:view_members",
        "document:draft",
        "document:edit",
        "meeting:manage",
        "email:send",
    ),
    ("學權部", "學權長"): (
        "org:view_members",
        "petition:view_org",
        "petition:assign",
        "petition:handle",
        "survey:create",
        "survey:manage",
        "announcement:create",
        "announcement:publish",
    ),
    ("活動部", "活動長"): (
        "org:view_members",
        "activity:manage",
        "activity:appoint",
        "meeting:create",
        "meeting:manage",
        "announcement:create",
        "announcement:publish",
        "email:send",
    ),
    ("活動部", "活動"): ("org:view_members", "activity:manage", "announcement:create"),
    ("公關部", "公關長"): (
        "org:view_members",
        "announcement:create",
        "announcement:edit",
        "announcement:publish",
        "announcement:media_manage",
        "announcement:view_stats",
        "email:send",
        "email:send_bulk",
    ),
    ("公關部", "公關"): (
        "org:view_members",
        "announcement:create",
        "announcement:edit",
        "announcement:media_manage",
    ),
    ("財務部", "財務長"): (
        "org:view_members",
        "finance:view",
        "finance:expense_claim",
        "finance:record",
        "finance:review",
        "finance:manage",
        "finance:budget",
        "finance:budget_propose",
        "finance:budget_review",
    ),
    ("財務部", "財務"): (
        "org:view_members",
        "finance:view",
        "finance:expense_claim",
        "finance:record",
    ),
    ("新聞部", "新聞長"): (
        "org:view_members",
        "announcement:create",
        "announcement:edit",
        "announcement:publish",
        "announcement:media_manage",
        "announcement:view_stats",
    ),
    ("設計部", "設計長"): (
        "org:view_members",
        "announcement:create",
        "announcement:edit",
        "announcement:media_manage",
    ),
    ("設計部", "設計"): ("org:view_members", "announcement:media_manage"),
    ("攝影部", "攝影長"): (
        "org:view_members",
        "announcement:create",
        "announcement:edit",
        "announcement:media_manage",
    ),
    ("攝影部", "攝影"): ("org:view_members", "announcement:media_manage"),
    ("資訊部", "資訊長"): ("org:view_members", "site:manage", "qr_code:manage"),
    ("資訊部", "資訊"): ("org:view_members", "site:manage"),
}


async def _get_or_create_root_org(session: AsyncSession) -> tuple[Org, bool]:
    result = await session.execute(
        select(Org).where(Org.name.in_(_ROOT_ORG_NAMES)).order_by(Org.name)
    )
    roots = list(result.scalars().all())
    if len(roots) > 1:
        raise ValueError("找到多個班聯會根組織，請先保留唯一的「班級聯合自治會」")
    if roots:
        return roots[0], False
    root = Org(name="班級聯合自治會", description="新竹高中班聯會組織架構")
    session.add(root)
    await session.flush()
    return root, True


async def _get_or_create_department(
    session: AsyncSession, root: Org, department: str
) -> tuple[Org, bool]:
    org = await session.scalar(select(Org).where(Org.parent_id == root.id, Org.name == department))
    if org is not None:
        return org, False
    org = Org(name=department, parent_id=root.id, description="115 學年度班聯會部門")
    session.add(org)
    await session.flush()
    return org, True


async def _get_or_create_position(
    session: AsyncSession, org: Org, assignment: CadreAssignment
) -> tuple[Position, bool, int]:
    position = await session.scalar(
        select(Position).where(
            Position.org_id == org.id,
            Position.name == assignment.position,
            Position.category == PositionCategory.COUNCIL,
        )
    )
    created = position is None
    if position is None:
        position = Position(
            org_id=org.id,
            name=assignment.position,
            category=PositionCategory.COUNCIL,
            weight=100 if assignment.is_leader else 10,
            description=f"115 學年度{assignment.department}{assignment.position}",
        )
        session.add(position)
        await session.flush()
    elif assignment.is_leader and position.weight < 100:
        position.weight = 100

    codes = set(_ROLE_PERMISSION_CODES[(assignment.department, assignment.position)])
    existing_codes = set(
        (
            await session.scalars(
                select(Permission.code).where(Permission.position_id == position.id)
            )
        ).all()
    )
    for code in sorted(codes - existing_codes):
        session.add(Permission(position_id=position.id, code=code))
    await session.flush()
    return position, created, len(codes - existing_codes)


async def _find_existing_user(session: AsyncSession, *, student_id: str, email: str) -> User | None:
    rows = (
        (
            await session.execute(
                select(User)
                .outerjoin(UserIdentity, UserIdentity.user_id == User.id)
                .where(
                    or_(
                        User.student_id == student_id,
                        func.lower(User.email) == email.lower(),
                        func.lower(UserIdentity.email) == email.lower(),
                    )
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    if len(rows) > 1:
        raise ValueError(f"學號 {student_id} 或 Email {email} 對應多個帳號，請先完成帳號合併")
    return rows[0] if rows else None


async def _get_or_create_user(
    session: AsyncSession,
    *,
    row: class_import_svc.ParsedContactDirectoryRow,
    actor: User,
    term_start: date,
    term_end: date | None,
) -> tuple[User, bool]:
    user = await _find_existing_user(session, student_id=row.student_id, email=row.email)
    if user is not None:
        if user.student_id and user.student_id != row.student_id:
            raise ValueError(f"{row.display_name} 的既有帳號學號與 PDF 不一致")
        if user.student_id is None:
            user.student_id = row.student_id
        return user, False
    user = await user_registration_svc.pre_register_user(
        session,
        student_id=row.student_id,
        email=row.email,
        linked_emails=[],
        display_name=row.display_name,
        position_ids=[],
        custom_permission_org_id=None,
        custom_permission_codes=[],
        start_date=term_start,
        end_date=term_end,
        actor=actor,
    )
    return user, True


async def _assign_user_position(
    session: AsyncSession,
    *,
    user: User,
    position: Position,
    term_start: date,
    term_end: date | None,
) -> bool:
    query = select(UserPosition).where(
        UserPosition.user_id == user.id,
        UserPosition.position_id == position.id,
        UserPosition.start_date == term_start,
    )
    query = query.where(
        UserPosition.end_date.is_(None) if term_end is None else UserPosition.end_date == term_end
    )
    existing = await session.scalar(query)
    if existing is not None:
        return False
    assignment = UserPosition(
        user_id=user.id,
        position_id=position.id,
        start_date=term_start,
        end_date=term_end,
    )
    session.add(assignment)
    await session.flush()
    await person_svc.record_affiliation_for_user_position(
        session,
        user=user,
        kind=PersonAffiliationKind.ORG_POSITION,
        position_id=position.id,
        start_date=term_start,
        end_date=term_end,
        synced_user_position_id=assignment.id,
        source=PersonAffiliationSource.RBAC_SYNC,
    )
    return True


async def import_hchs_cadre_directory(
    session: AsyncSession,
    *,
    file_bytes: bytes,
    filename: str | None,
    academic_year: int,
    term_start: date,
    term_end: date | None,
    actor: User,
) -> CadreDirectoryImportOut:
    """依通訊錄與既定職務表，建立帳號、班級名冊、組織職位及任期。"""
    directory = class_import_svc.parse_contact_directory_pdf(file_bytes)
    by_name = {row.display_name: row for row in directory}
    required_names = {assignment.display_name for assignment in _CADRE_ASSIGNMENTS}
    missing_names = sorted(required_names - set(by_name))
    if missing_names:
        raise ValueError(f"通訊錄缺少幹部：{'、'.join(missing_names)}")

    users_by_name: dict[str, User] = {}
    users_created = 0
    users_reused = 0
    for name in sorted(required_names):
        user, created = await _get_or_create_user(
            session,
            row=by_name[name],
            actor=actor,
            term_start=term_start,
            term_end=term_end,
        )
        users_by_name[name] = user
        users_created += int(created)
        users_reused += int(not created)

    roster = await class_import_svc.import_roster_pdf(
        session,
        file_bytes=file_bytes,
        filename=filename,
        academic_year=academic_year,
        created_by=actor.id,
    )

    root, root_created = await _get_or_create_root_org(session)
    orgs_created = int(root_created)
    positions_created = 0
    permissions_added = 0
    assignments_created = 0
    departments: dict[str, Org] = {}
    for assignment in _CADRE_ASSIGNMENTS:
        department = departments.get(assignment.department)
        if department is None:
            department, created = await _get_or_create_department(
                session, root, assignment.department
            )
            departments[assignment.department] = department
            orgs_created += int(created)
        position, created, added = await _get_or_create_position(session, department, assignment)
        positions_created += int(created)
        permissions_added += added
        if await _assign_user_position(
            session,
            user=users_by_name[assignment.display_name],
            position=position,
            term_start=term_start,
            term_end=term_end,
        ):
            assignments_created += 1
        if assignment.is_leader:
            department.leader_user_id = users_by_name[assignment.display_name].id

    await session.flush()
    for user in users_by_name.values():
        await cache_invalidate_user_permissions(str(user.id))

    return CadreDirectoryImportOut(
        academic_year=academic_year,
        source_rows=len(directory),
        cadre_members=len(required_names),
        users_created=users_created,
        users_reused=users_reused,
        orgs_created=orgs_created,
        positions_created=positions_created,
        permissions_added=permissions_added,
        assignments_created=assignments_created,
        roster_created=roster.roster_created,
        roster_updated=roster.roster_updated,
        class_codes=roster.class_codes,
    )
