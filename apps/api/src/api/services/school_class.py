"""班級系統服務層 - 班級 CRUD / 學號區間 / 幹部 / 自動歸班

可重用 helper（resolve_user_class / get_cadre_class_ids / list_class_members）
供商品系統與日後學餐系統共用「依班級歸戶、幹部結單」制度。
"""

from __future__ import annotations

import re
import uuid
from datetime import date, timedelta

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from api.core.clock import local_today
from api.models.org import Org, Permission, Position, PositionCategory, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
)
from api.models.school_class import (
    ClassCadre,
    ClassManualMember,
    ClassMembership,
    ClassMembershipStatus,
    ClassRoleBinding,
    ClassRoleKey,
    ClassRosterEntry,
    ClassStudentRange,
    SchoolClass,
)
from api.models.user import User
from api.schemas.person import PersonAffiliationCreate
from api.schemas.school_class import (
    ClassManualMemberCreate,
    ClassManualMemberOut,
    ClassMemberOut,
    ClassMembershipCreate,
    ClassRoleAssign,
    ClassRolePersonAssign,
    ClassRosterBulkCreate,
    ClassRosterBulkOut,
    ClassRosterEntryCreate,
    ClassRosterEntryUpdate,
    ClassStudentRangeCreate,
    SchoolClassBulkActionOut,
    SchoolClassBulkActionResult,
    SchoolClassBulkCreate,
    SchoolClassBulkCreateOut,
    SchoolClassBulkCreateResult,
    SchoolClassCreate,
    SchoolClassUpdate,
)
from api.services import person as person_svc
from api.services.permission import active_tenure_filter

CLASS_ROLE_DEFINITIONS: dict[str, tuple[str, list[str], int]] = {
    ClassRoleKey.CLASS_LEADER: (
        "班長",
        ["class:view_members", "class:meal_collect", "class:meal_pickup"],
        80,
    ),
    ClassRoleKey.VICE_LEADER: (
        "副班長",
        ["class:view_members", "class:meal_collect", "class:meal_pickup"],
        70,
    ),
    ClassRoleKey.CLASS_REPRESENTATIVE: (
        "班代",
        [
            "class:view_members",
            "class:shop_collect",
            "regulation:create",
            "regulation:submit",
            "document:create",
        ],
        90,
    ),
}

COUNCIL_ORG_NAMES = ("學生代表大會", "議會", "學生議會")
COUNCIL_REPRESENTATIVE_POSITION_NAME = "議員"

# ── 學號區間比對 ──────────────────────────────────────────────────────────────


def student_id_in_range(student_id: str, start: str, end: str) -> bool:
    """判斷學號是否落在區間內（皆為數字時以整數比較，否則以字串比較）"""
    if not student_id:
        return False
    if student_id.isdigit() and start.isdigit() and end.isdigit():
        return int(start) <= int(student_id) <= int(end)
    lo, hi = sorted((start, end))
    return lo <= student_id <= hi


def class_display_label(sc: SchoolClass | None) -> str | None:
    """班級顯示名稱（優先用 label，否則組合學年度＋班級代碼）"""
    if sc is None:
        return None
    return sc.label or f"{sc.academic_year} 學年度 {sc.class_code} 班"


# ── 班級 CRUD ─────────────────────────────────────────────────────────────────


async def get_class(session: AsyncSession, class_id: uuid.UUID) -> SchoolClass | None:
    result = await session.execute(
        select(SchoolClass)
        .options(
            selectinload(SchoolClass.ranges),
            selectinload(SchoolClass.roster_entries).selectinload(ClassRosterEntry.user),
            selectinload(SchoolClass.manual_members).selectinload(ClassManualMember.user),
            selectinload(SchoolClass.cadres).selectinload(ClassCadre.user),
            selectinload(SchoolClass.memberships).selectinload(ClassMembership.user),
            selectinload(SchoolClass.role_bindings),
        )
        .where(SchoolClass.id == class_id)
    )
    return result.scalar_one_or_none()


async def list_classes(
    session: AsyncSession,
    *,
    academic_year: int | None = None,
    is_active: bool | None = None,
) -> list[SchoolClass]:
    # The list response only exposes the basic class fields. Loading every
    # roster, membership, cadre, and role for every class made this endpoint
    # scale with the entire class database instead of the number of classes.
    q = select(SchoolClass)
    if academic_year is not None:
        q = q.where(SchoolClass.academic_year == academic_year)
    if is_active is not None:
        q = q.where(SchoolClass.is_active == is_active)
    q = q.order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


async def list_class_representative_overview(session: AsyncSession) -> list[dict[str, object]]:
    """彙總目前啟用班級的班代任命，不補建預設職位。"""
    classes_result = await session.execute(
        select(SchoolClass)
        .where(SchoolClass.is_active.is_(True))
        .order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    )
    classes = list(classes_result.scalars().all())
    if not classes:
        return []

    class_ids = [school_class.id for school_class in classes]
    representatives_by_class: dict[uuid.UUID, list[str]] = {class_id: [] for class_id in class_ids}
    today = local_today()

    user_holders_result = await session.execute(
        select(ClassRoleBinding.class_id, User.display_name)
        .join(UserPosition, UserPosition.position_id == ClassRoleBinding.position_id)
        .join(User, User.id == UserPosition.user_id)
        .where(
            ClassRoleBinding.class_id.in_(class_ids),
            ClassRoleBinding.role_key == ClassRoleKey.CLASS_REPRESENTATIVE,
            UserPosition.start_date <= today,
            (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today),
        )
        .order_by(UserPosition.start_date.desc())
    )
    for class_id, display_name in user_holders_result.all():
        representatives_by_class[class_id].append(display_name)

    person_holders_result = await session.execute(
        select(PersonAffiliation.class_id, Person.display_name)
        .join(
            ClassRoleBinding,
            and_(
                ClassRoleBinding.class_id == PersonAffiliation.class_id,
                ClassRoleBinding.position_id == PersonAffiliation.position_id,
                ClassRoleBinding.role_key == ClassRoleKey.CLASS_REPRESENTATIVE,
            ),
        )
        .join(Person, Person.id == PersonAffiliation.person_id)
        .where(
            PersonAffiliation.class_id.in_(class_ids),
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_ROLE,
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
            PersonAffiliation.start_date <= today,
            (PersonAffiliation.end_date.is_(None)) | (PersonAffiliation.end_date >= today),
            Person.user_id.is_(None),
        )
        .order_by(PersonAffiliation.start_date.desc())
    )
    for class_id, display_name in person_holders_result.all():
        if class_id is not None:
            representatives_by_class[class_id].append(display_name)

    return [
        {
            "id": school_class.id,
            "academic_year": school_class.academic_year,
            "class_code": school_class.class_code,
            "grade": school_class.grade,
            "label": school_class.label,
            "is_active": school_class.is_active,
            "representatives": representatives_by_class[school_class.id],
        }
        for school_class in classes
    ]


async def list_recipient_options(session: AsyncSession) -> list[SchoolClass]:
    """回傳可作為公文受文者的現行班級，避免把班級當成自治組織。"""
    result = await session.execute(
        select(SchoolClass)
        .where(SchoolClass.is_active.is_(True))
        .order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    )
    return list(result.scalars().all())


async def get_user_active_class_ids(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """取得使用者目前所屬的所有班級，涵蓋手動、名冊與學號區間。"""
    user = await session.get(User, user_id)
    if user is None:
        return set()
    result = await session.execute(
        select(SchoolClass)
        .options(
            selectinload(SchoolClass.ranges),
            selectinload(SchoolClass.roster_entries),
            selectinload(SchoolClass.manual_members),
        )
        .where(SchoolClass.is_active.is_(True))
    )
    # 三種歸屬來源已批次載入；轉出排除也一次取得，避免逐班補查空的 ranges。
    excluded = await _excluded_range_memberships(session, user_id=user.id)
    class_ids: set[uuid.UUID] = set()
    for school_class in result.scalars().unique():
        explicit_member = any(
            member.user_id == user.id for member in school_class.manual_members
        ) or any(
            entry.user_id == user.id
            or (entry.user_id is None and entry.student_id == user.student_id)
            for entry in school_class.roster_entries
        )
        if explicit_member or (
            (school_class.id, user.id) not in excluded and _user_in_class_ranges(user, school_class)
        ):
            class_ids.add(school_class.id)
    return class_ids


async def create_class(
    session: AsyncSession, *, data: SchoolClassCreate, created_by: uuid.UUID
) -> SchoolClass:
    org = Org(
        name=data.label or f"{data.academic_year} 學年度 {data.class_code} 班",
        description="班級系統自動建立的 RBAC 組織",
    )
    session.add(org)
    await session.flush()
    sc = SchoolClass(
        academic_year=data.academic_year,
        class_code=data.class_code,
        grade=data.grade,
        label=data.label,
        created_by=created_by,
        org_id=org.id,
    )
    for r in data.ranges:
        sc.ranges.append(
            ClassStudentRange(
                student_id_start=r.student_id_start,
                student_id_end=r.student_id_end,
            )
        )
    session.add(sc)
    await session.flush()
    await ensure_class_default_roles(session, sc)
    return await get_class(session, sc.id)  # type: ignore[return-value]


async def ensure_class_default_roles(
    session: AsyncSession, sc: SchoolClass
) -> list[ClassRoleBinding]:
    if sc.org_id is None:
        org = Org(
            name=class_display_label(sc) or sc.class_code,
            description="班級系統自動建立的 RBAC 組織",
        )
        session.add(org)
        await session.flush()
        sc.org_id = org.id
    existing_result = await session.execute(
        select(ClassRoleBinding).where(ClassRoleBinding.class_id == sc.id)
    )
    existing = {binding.role_key: binding for binding in existing_result.scalars().all()}
    codes_by_position: dict[uuid.UUID, set[str]] = {}
    if existing:
        for position_id, code in await session.execute(
            select(Permission.position_id, Permission.code).where(
                Permission.position_id.in_([binding.position_id for binding in existing.values()])
            )
        ):
            codes_by_position.setdefault(position_id, set()).add(code)
    bindings: list[ClassRoleBinding] = []
    for role_key, (title, codes, weight) in CLASS_ROLE_DEFINITIONS.items():
        if role_key in existing:
            binding = existing[role_key]
            existing_codes = codes_by_position.get(binding.position_id, set())
            for code in codes:
                if code not in existing_codes:
                    session.add(Permission(position_id=binding.position_id, code=code))
            bindings.append(binding)
            continue
        position = Position(
            org_id=sc.org_id,
            name=title,
            category=PositionCategory.CLASS,
            weight=weight,
        )
        session.add(position)
        await session.flush()
        for code in codes:
            session.add(Permission(position_id=position.id, code=code))
        binding = ClassRoleBinding(class_id=sc.id, role_key=role_key, position_id=position.id)
        session.add(binding)
        bindings.append(binding)
    await session.flush()
    return bindings


async def list_class_roles(session: AsyncSession, sc: SchoolClass) -> list[dict]:
    await ensure_class_default_roles(session, sc)
    today = local_today()
    result = await session.execute(
        select(ClassRoleBinding)
        .options(selectinload(ClassRoleBinding.position).selectinload(Position.permissions))
        .where(ClassRoleBinding.class_id == sc.id)
    )
    bindings = list(result.scalars().all())
    position_ids = [binding.position_id for binding in bindings]
    holders_by_position: dict[uuid.UUID, list[UserPosition]] = {}
    for holder in await session.scalars(
        select(UserPosition)
        .options(selectinload(UserPosition.user))
        .where(
            UserPosition.position_id.in_(position_ids),
            UserPosition.start_date <= today,
            (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today),
        )
        .order_by(UserPosition.start_date.desc())
    ):
        holders_by_position.setdefault(holder.position_id, []).append(holder)
    people_by_position: dict[uuid.UUID, list[PersonAffiliation]] = {}
    for affiliation in await session.scalars(
        select(PersonAffiliation)
        .join(PersonAffiliation.person)
        .options(selectinload(PersonAffiliation.person))
        .where(
            PersonAffiliation.class_id == sc.id,
            PersonAffiliation.position_id.in_(position_ids),
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_ROLE,
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
            PersonAffiliation.start_date <= today,
            (PersonAffiliation.end_date.is_(None)) | (PersonAffiliation.end_date >= today),
            Person.user_id.is_(None),
        )
        .order_by(PersonAffiliation.start_date.desc())
    ):
        people_by_position.setdefault(affiliation.position_id, []).append(affiliation)
    rows: list[dict] = []
    for binding in bindings:
        holders = [
            {
                "user_position_id": up.id,
                "user_id": up.user_id,
                "display_name": up.user.display_name if up.user else "",
                "email": up.user.email if up.user else "",
                "student_id": up.user.student_id if up.user else None,
                "start_date": up.start_date,
                "end_date": up.end_date,
            }
            for up in holders_by_position.get(binding.position_id, [])
        ]
        person_holders = [
            {
                "affiliation_id": affiliation.id,
                "person_id": affiliation.person_id,
                "display_name": affiliation.person.display_name,
                "email": affiliation.person.email or "",
                "student_id": affiliation.person.student_id,
                "start_date": affiliation.start_date,
                "end_date": affiliation.end_date,
                "status": affiliation.status,
            }
            for affiliation in people_by_position.get(binding.position_id, [])
            if affiliation.person is not None
        ]
        label = CLASS_ROLE_DEFINITIONS.get(binding.role_key, (binding.role_key, [], 0))[0]
        rows.append(
            {
                "id": binding.id,
                "class_id": binding.class_id,
                "role_key": binding.role_key,
                "label": label,
                "position_id": binding.position_id,
                "permission_codes": [
                    permission.code
                    for permission in (binding.position.permissions if binding.position else [])
                ],
                "holders": holders,
                "person_holders": person_holders,
            }
        )
    rows.sort(
        key=lambda row: CLASS_ROLE_DEFINITIONS.get(row["role_key"], ("", [], 0))[2],
        reverse=True,
    )
    return rows


def _render_class_template(
    template: str,
    *,
    academic_year: int,
    grade: int,
    class_no: int,
    class_no_width: int = 2,
    student_no: int | None = None,
    student_no_width: int = 2,
) -> str:
    values = {
        "academic_year": academic_year,
        "grade": grade,
        "class_no": class_no,
        "class_no_padded": str(class_no).zfill(class_no_width),
        "student_no": student_no if student_no is not None else "",
        "student_no_padded": "" if student_no is None else str(student_no).zfill(student_no_width),
    }

    # 不用 str.format()：它允許 `{academic_year.__class__...}` 之類的屬性穿透，
    # 在 template 由使用者輸入時可被用來讀取物件內部（資訊洩漏）。改為只替換
    # 已知的 `{word}` 佔位符；未知變數拋錯，含 `.`/索引存取的片段不符 `\w+` 故原樣保留。
    def _sub(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in values:
            raise ValueError(f"不支援的模板變數：{key}")
        return str(values[key])

    return re.sub(r"\{(\w+)\}", _sub, template)


async def bulk_create_classes(
    session: AsyncSession, *, data: SchoolClassBulkCreate, created_by: uuid.UUID
) -> SchoolClassBulkCreateOut:
    existing_result = await session.execute(
        select(SchoolClass.class_code).where(SchoolClass.academic_year == data.academic_year)
    )
    existing_codes = set(existing_result.scalars().all())
    results: list[SchoolClassBulkCreateResult] = []

    for grade_rule in data.grades:
        class_start, class_end = sorted((grade_rule.class_start, grade_rule.class_end))
        overrides = {override.class_no: override for override in grade_rule.class_overrides}
        for class_no in range(class_start, class_end + 1):
            class_no_width = (
                grade_rule.range_template.class_no_width if grade_rule.range_template else 2
            )
            try:
                class_code = _render_class_template(
                    grade_rule.class_code_template,
                    academic_year=data.academic_year,
                    grade=grade_rule.grade,
                    class_no=class_no,
                    class_no_width=class_no_width,
                )
                label = (
                    _render_class_template(
                        grade_rule.label_template,
                        academic_year=data.academic_year,
                        grade=grade_rule.grade,
                        class_no=class_no,
                        class_no_width=class_no_width,
                    )
                    if grade_rule.label_template
                    else None
                )
            except ValueError as e:
                results.append(
                    SchoolClassBulkCreateResult(class_code="", label=None, ok=False, detail=str(e))
                )
                continue

            if class_code in existing_codes:
                results.append(
                    SchoolClassBulkCreateResult(
                        class_code=class_code,
                        label=label,
                        ok=False,
                        detail="同一學年度已存在，已略過",
                    )
                )
                continue

            sc = SchoolClass(
                academic_year=data.academic_year,
                class_code=class_code,
                grade=grade_rule.grade,
                label=label,
                is_active=data.is_active,
                created_by=created_by,
            )
            if grade_rule.range_template is not None:
                tmpl = grade_rule.range_template
                override = overrides.get(class_no)
                student_no_start = override.student_no_start if override else None
                student_no_end = override.student_no_end if override else None
                student_start, student_end = sorted(
                    (
                        student_no_start if student_no_start is not None else tmpl.student_no_start,
                        student_no_end if student_no_end is not None else tmpl.student_no_end,
                    )
                )
                try:
                    sc.ranges.append(
                        ClassStudentRange(
                            student_id_start=_render_class_template(
                                tmpl.student_id_start_template,
                                academic_year=data.academic_year,
                                grade=grade_rule.grade,
                                class_no=class_no,
                                class_no_width=tmpl.class_no_width,
                                student_no=student_start,
                                student_no_width=tmpl.student_no_width,
                            ),
                            student_id_end=_render_class_template(
                                tmpl.student_id_end_template,
                                academic_year=data.academic_year,
                                grade=grade_rule.grade,
                                class_no=class_no,
                                class_no_width=tmpl.class_no_width,
                                student_no=student_end,
                                student_no_width=tmpl.student_no_width,
                            ),
                        )
                    )
                except ValueError as e:
                    results.append(
                        SchoolClassBulkCreateResult(
                            class_code=class_code,
                            label=label,
                            ok=False,
                            detail=str(e),
                        )
                    )
                    continue
            session.add(sc)
            await session.flush()
            await ensure_class_default_roles(session, sc)
            existing_codes.add(class_code)
            results.append(
                SchoolClassBulkCreateResult(
                    class_code=class_code,
                    label=label,
                    ok=True,
                    class_id=sc.id,
                    detail="已建立",
                )
            )

    succeeded = sum(1 for r in results if r.ok)
    skipped = sum(1 for r in results if r.detail == "同一學年度已存在，已略過")
    failed = len(results) - succeeded - skipped
    return SchoolClassBulkCreateOut(
        total=len(results),
        succeeded=succeeded,
        skipped=skipped,
        failed=failed,
        results=results,
    )


async def update_class(
    session: AsyncSession, sc: SchoolClass, *, data: SchoolClassUpdate
) -> SchoolClass:
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(sc, field, value)
    await session.flush()
    return sc


async def bulk_action_classes(
    session: AsyncSession, *, class_ids: list[uuid.UUID], action: str
) -> SchoolClassBulkActionOut:
    seen_ids = list(dict.fromkeys(class_ids))
    found_result = await session.execute(select(SchoolClass).where(SchoolClass.id.in_(seen_ids)))
    classes_by_id = {sc.id: sc for sc in found_result.scalars().all()}
    results: list[SchoolClassBulkActionResult] = []

    for class_id in seen_ids:
        sc = classes_by_id.get(class_id)
        if sc is None:
            results.append(
                SchoolClassBulkActionResult(class_id=class_id, ok=False, detail="找不到此班級")
            )
            continue

        label = class_display_label(sc)
        if action == "activate":
            sc.is_active = True
            results.append(SchoolClassBulkActionResult(class_id=sc.id, label=label, ok=True))
        elif action == "deactivate":
            sc.is_active = False
            results.append(SchoolClassBulkActionResult(class_id=sc.id, label=label, ok=True))
        elif action == "delete":
            await session.delete(sc)
            results.append(SchoolClassBulkActionResult(class_id=sc.id, label=label, ok=True))
        else:
            raise ValueError("不支援的批量操作")

    await session.flush()
    succeeded = sum(1 for result in results if result.ok)
    return SchoolClassBulkActionOut(
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
        results=results,
    )


# ── 學號區間 ──────────────────────────────────────────────────────────────────


async def _find_roster_user(session: AsyncSession, student_id: str) -> User | None:
    return await session.scalar(select(User).where(User.student_id == student_id))


async def _ensure_roster_unique(
    session: AsyncSession,
    sc: SchoolClass,
    *,
    seat_number: int,
    student_id: str,
    exclude_id: uuid.UUID | None = None,
) -> None:
    query = select(ClassRosterEntry).where(
        ClassRosterEntry.class_id == sc.id,
        (ClassRosterEntry.seat_number == seat_number) | (ClassRosterEntry.student_id == student_id),
    )
    if exclude_id is not None:
        query = query.where(ClassRosterEntry.id != exclude_id)
    existing = await session.scalar(query)
    if existing is None:
        return
    if existing.seat_number == seat_number:
        raise ValueError(f"座號 {seat_number} 已有名冊資料")
    raise ValueError(f"學號 {student_id} 已在此班級名冊")


async def _end_roster_membership(
    session: AsyncSession, class_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    membership = await session.scalar(
        select(ClassMembership).where(
            ClassMembership.class_id == class_id,
            ClassMembership.user_id == user_id,
            ClassMembership.source == "roster",
            ClassMembership.status == ClassMembershipStatus.ACTIVE,
        )
    )
    if membership is not None:
        membership.status = ClassMembershipStatus.ENDED
        membership.end_date = local_today()


async def add_roster_entry(
    session: AsyncSession, sc: SchoolClass, *, data: ClassRosterEntryCreate
) -> ClassRosterEntry:
    student_id = data.student_id.strip()
    await _ensure_roster_unique(session, sc, seat_number=data.seat_number, student_id=student_id)
    user = await _find_roster_user(session, student_id)
    entry = ClassRosterEntry(
        seat_number=data.seat_number,
        student_id=student_id,
        user_id=user.id if user else None,
    )
    sc.roster_entries.append(entry)
    await session.flush()
    if user is not None:
        await add_membership(
            session,
            sc,
            data=ClassMembershipCreate(user_id=user.id, source="roster"),
        )
    await session.refresh(entry, attribute_names=["user"])
    return entry


async def update_roster_entry(
    session: AsyncSession,
    sc: SchoolClass,
    entry_id: uuid.UUID,
    *,
    data: ClassRosterEntryUpdate,
) -> ClassRosterEntry:
    entry = await session.scalar(
        select(ClassRosterEntry).where(
            ClassRosterEntry.id == entry_id,
            ClassRosterEntry.class_id == sc.id,
        )
    )
    if entry is None:
        raise ValueError("找不到此名冊資料")
    previous_user_id = entry.user_id
    values = data.model_dump(exclude_none=True)
    seat_number = values.get("seat_number", entry.seat_number)
    student_id = values.get("student_id", entry.student_id).strip()
    await _ensure_roster_unique(
        session,
        sc,
        seat_number=seat_number,
        student_id=student_id,
        exclude_id=entry.id,
    )
    user = await _find_roster_user(session, student_id)
    entry.seat_number = seat_number
    entry.student_id = student_id
    entry.user_id = user.id if user else None
    await session.flush()
    if previous_user_id is not None and previous_user_id != entry.user_id:
        await _end_roster_membership(session, sc.id, previous_user_id)
    if user is not None:
        await add_membership(
            session,
            sc,
            data=ClassMembershipCreate(user_id=user.id, source="roster"),
        )
    await session.refresh(entry, attribute_names=["user"])
    return entry


async def bulk_upsert_roster(
    session: AsyncSession, sc: SchoolClass, *, data: ClassRosterBulkCreate
) -> ClassRosterBulkOut:
    seen_seats: set[int] = set()
    seen_student_ids: set[str] = set()
    entries = []
    created = 0
    updated = 0
    for item in data.entries:
        student_id = item.student_id.strip()
        if item.seat_number in seen_seats or student_id in seen_student_ids:
            raise ValueError("批次資料中有重複的座號或學號")
        seen_seats.add(item.seat_number)
        seen_student_ids.add(student_id)
        existing = await session.scalar(
            select(ClassRosterEntry).where(
                ClassRosterEntry.class_id == sc.id,
                ClassRosterEntry.seat_number == item.seat_number,
            )
        )
        if existing is None:
            existing = await session.scalar(
                select(ClassRosterEntry).where(
                    ClassRosterEntry.class_id == sc.id,
                    ClassRosterEntry.student_id == student_id,
                )
            )
        if existing is None:
            entry = await add_roster_entry(
                session,
                sc,
                data=ClassRosterEntryCreate(
                    seat_number=item.seat_number,
                    student_id=student_id,
                ),
            )
            created += 1
        else:
            entry = await update_roster_entry(
                session,
                sc,
                existing.id,
                data=ClassRosterEntryUpdate(
                    seat_number=item.seat_number,
                    student_id=student_id,
                ),
            )
            updated += 1
        entries.append(entry)
    return ClassRosterBulkOut(total=len(entries), created=created, updated=updated, entries=entries)


async def list_roster_entries(session: AsyncSession, sc: SchoolClass) -> list[ClassRosterEntry]:
    await link_roster_accounts(session, class_id=sc.id)
    result = await session.execute(
        select(ClassRosterEntry)
        .options(selectinload(ClassRosterEntry.user))
        .execution_options(populate_existing=True)
        .where(ClassRosterEntry.class_id == sc.id)
        .order_by(ClassRosterEntry.seat_number)
    )
    return list(result.scalars().all())


async def delete_roster_entry(
    session: AsyncSession, class_id: uuid.UUID, entry_id: uuid.UUID
) -> bool:
    entry = await session.scalar(
        select(ClassRosterEntry).where(
            ClassRosterEntry.id == entry_id,
            ClassRosterEntry.class_id == class_id,
        )
    )
    if entry is None:
        return False
    if entry.user_id is not None:
        await _end_roster_membership(session, class_id, entry.user_id)
    await session.delete(entry)
    await session.flush()
    return True


# ── 學號區間 ──────────────────────────────────────────────────────────────────


async def add_range(
    session: AsyncSession, sc: SchoolClass, *, data: ClassStudentRangeCreate
) -> ClassStudentRange:
    rng = ClassStudentRange(
        student_id_start=data.student_id_start,
        student_id_end=data.student_id_end,
    )
    sc.ranges.append(rng)
    await session.flush()
    return rng


async def delete_range(session: AsyncSession, range_id: uuid.UUID) -> bool:
    rng = await session.get(ClassStudentRange, range_id)
    if rng is None:
        return False
    await session.delete(rng)
    await session.flush()
    return True


# ── 手動成員 ──────────────────────────────────────────────────────────────────


async def add_manual_member(
    session: AsyncSession, sc: SchoolClass, *, data: ClassManualMemberCreate
) -> ClassManualMember:
    user = await session.get(User, data.user_id)
    if user is None:
        raise ValueError("找不到此使用者")
    if any(member.user_id == data.user_id for member in sc.manual_members):
        raise ValueError("此使用者已是該班手動成員")
    member = ClassManualMember(user_id=data.user_id)
    sc.manual_members.append(member)
    await session.flush()
    await session.refresh(member, attribute_names=["user"])
    await add_membership(
        session,
        sc,
        data=ClassMembershipCreate(user_id=data.user_id, source="manual"),
    )
    return member


async def add_membership(
    session: AsyncSession, sc: SchoolClass, *, data: ClassMembershipCreate
) -> ClassMembership:
    user = await session.get(User, data.user_id)
    if user is None:
        raise ValueError("找不到此使用者")
    existing = await session.scalar(
        select(ClassMembership).where(
            ClassMembership.class_id == sc.id,
            ClassMembership.user_id == data.user_id,
            ClassMembership.status == ClassMembershipStatus.ACTIVE,
        )
    )
    if existing:
        return existing
    membership = ClassMembership(
        class_id=sc.id,
        user_id=data.user_id,
        academic_year=sc.academic_year,
        source=data.source,
        status=ClassMembershipStatus.ACTIVE,
        start_date=data.start_date or local_today(),
    )
    session.add(membership)
    await session.flush()
    await session.refresh(membership, attribute_names=["user"])
    person = await person_svc.ensure_person_for_user(
        session, user, source=PersonAffiliationSource.CLASS_WORKSPACE
    )
    await person_svc.create_affiliation(
        session,
        data=PersonAffiliationCreate(
            person_id=person.id,
            kind=PersonAffiliationKind.CLASS_MEMBER,
            academic_year=sc.academic_year,
            class_id=sc.id,
            start_date=membership.start_date,
            source=PersonAffiliationSource.CLASS_WORKSPACE,
        ),
    )
    return membership


async def end_membership(
    session: AsyncSession, class_id: uuid.UUID, user_id: uuid.UUID, *, end_date: date | None = None
) -> bool:
    membership = await session.scalar(
        select(ClassMembership).where(
            ClassMembership.class_id == class_id,
            ClassMembership.user_id == user_id,
            ClassMembership.status == ClassMembershipStatus.ACTIVE,
        )
    )
    if membership is None:
        return False
    membership.status = ClassMembershipStatus.ENDED
    membership.end_date = end_date or local_today()
    affiliations = await session.scalars(
        select(PersonAffiliation)
        .join(Person, Person.id == PersonAffiliation.person_id)
        .where(
            Person.user_id == user_id,
            PersonAffiliation.class_id == class_id,
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.status == PersonAffiliationStatus.ACTIVE,
        )
    )
    for affiliation in affiliations:
        affiliation.status = PersonAffiliationStatus.ENDED
        affiliation.end_date = membership.end_date
    await session.flush()
    return True


async def list_memberships(session: AsyncSession, sc: SchoolClass) -> list[ClassMembership]:
    result = await session.execute(
        select(ClassMembership)
        .options(selectinload(ClassMembership.user))
        .where(ClassMembership.class_id == sc.id)
        .order_by(ClassMembership.status, ClassMembership.created_at)
    )
    return list(result.scalars().all())


async def assign_class_role(
    session: AsyncSession, sc: SchoolClass, *, role_key: str, data: ClassRoleAssign
) -> UserPosition:
    await ensure_class_default_roles(session, sc)
    binding = await session.scalar(
        select(ClassRoleBinding).where(
            ClassRoleBinding.class_id == sc.id,
            ClassRoleBinding.role_key == role_key,
        )
    )
    if binding is None:
        raise ValueError("找不到此班級職位")
    existing = await session.scalar(
        select(UserPosition).where(
            UserPosition.user_id == data.user_id,
            UserPosition.position_id == binding.position_id,
            UserPosition.start_date == (data.start_date or local_today()),
            UserPosition.end_date.is_(None)
            if data.end_date is None
            else UserPosition.end_date == data.end_date,
        )
    )
    if existing is not None:
        return existing
    await add_membership(
        session,
        sc,
        data=ClassMembershipCreate(
            user_id=data.user_id, source="manual", start_date=data.start_date
        ),
    )
    up = UserPosition(
        user_id=data.user_id,
        position_id=binding.position_id,
        start_date=data.start_date or local_today(),
        end_date=data.end_date,
    )
    session.add(up)
    await session.flush()
    user = await session.get(User, data.user_id)
    if user is not None:
        await person_svc.record_affiliation_for_user_position(
            session,
            user=user,
            kind=PersonAffiliationKind.CLASS_ROLE,
            position_id=binding.position_id,
            start_date=up.start_date,
            end_date=up.end_date,
            class_id=sc.id,
            role_key=role_key,
            synced_user_position_id=up.id,
            source=PersonAffiliationSource.CLASS_WORKSPACE,
        )
    if role_key == ClassRoleKey.CLASS_REPRESENTATIVE:
        council_position = await get_or_create_council_representative_position(session)
        if council_position is not None and user is not None:
            council_up = UserPosition(
                user_id=data.user_id,
                position_id=council_position.id,
                start_date=data.start_date or local_today(),
                end_date=data.end_date,
            )
            session.add(council_up)
            await session.flush()
            await person_svc.record_affiliation_for_user_position(
                session,
                user=user,
                kind=PersonAffiliationKind.ORG_POSITION,
                position_id=council_position.id,
                start_date=council_up.start_date,
                end_date=council_up.end_date,
                synced_user_position_id=council_up.id,
                source=PersonAffiliationSource.CLASS_WORKSPACE,
            )
    await session.flush()
    return up


async def assign_class_person_role(
    session: AsyncSession,
    sc: SchoolClass,
    *,
    role_key: str,
    data: ClassRolePersonAssign,
) -> PersonAffiliation:
    await ensure_class_default_roles(session, sc)
    binding = await session.scalar(
        select(ClassRoleBinding).where(
            ClassRoleBinding.class_id == sc.id,
            ClassRoleBinding.role_key == role_key,
        )
    )
    if binding is None:
        raise ValueError("找不到此班級職位")

    person: Person | None
    roster_entry: ClassRosterEntry | None = None
    if data.person_id is not None:
        person = await session.get(Person, data.person_id)
        if person is None:
            raise ValueError("找不到此人員主檔")
        if data.student_id and data.student_id.strip() != person.student_id:
            raise ValueError("人員主檔與學號不相符")
    else:
        student_id = (data.student_id or "").strip()
        if not student_id:
            raise ValueError("請提供人員主檔或學號")
        roster_entry = await session.scalar(
            select(ClassRosterEntry).where(
                ClassRosterEntry.class_id == sc.id,
                ClassRosterEntry.student_id == student_id,
            )
        )
        if roster_entry is None:
            raise ValueError("此學號不在本班座號名冊")
        person = await session.scalar(select(Person).where(Person.student_id == student_id))
        if person is None:
            display_name = (data.display_name or "").strip()
            if not display_name:
                raise ValueError("請輸入未註冊同學的姓名")
            person = Person(
                student_id=student_id,
                display_name=display_name,
                note="由班級工作台從座號名冊建立",
            )
            session.add(person)
            await session.flush()

    if person.user_id is not None:
        raise ValueError("此同學已連結校內帳號，請使用帳號任命")

    member_affiliation = await session.scalar(
        select(PersonAffiliation.id).where(
            PersonAffiliation.person_id == person.id,
            PersonAffiliation.class_id == sc.id,
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
            PersonAffiliation.start_date <= local_today(),
            (PersonAffiliation.end_date.is_(None)) | (PersonAffiliation.end_date >= local_today()),
        )
    )
    if roster_entry is None and person.student_id:
        roster_entry = await session.scalar(
            select(ClassRosterEntry).where(
                ClassRosterEntry.class_id == sc.id,
                ClassRosterEntry.student_id == person.student_id,
            )
        )
    if member_affiliation is None and roster_entry is None:
        raise ValueError("此人員不是本班成員")

    if member_affiliation is None:
        await person_svc.create_affiliation(
            session,
            data=PersonAffiliationCreate(
                person_id=person.id,
                kind=PersonAffiliationKind.CLASS_MEMBER,
                class_id=sc.id,
                source=PersonAffiliationSource.CLASS_WORKSPACE,
            ),
        )

    return await person_svc.create_affiliation(
        session,
        data=PersonAffiliationCreate(
            person_id=person.id,
            kind=PersonAffiliationKind.CLASS_ROLE,
            class_id=sc.id,
            position_id=binding.position_id,
            role_key=role_key,
            source=PersonAffiliationSource.CLASS_WORKSPACE,
        ),
    )


async def sync_class_representative_council_roles(session: AsyncSession, person: Person) -> None:
    """補齊班代的議員職位，包含舊帳號登入前留下的班代任命。"""
    result = await session.scalars(
        select(PersonAffiliation).where(
            PersonAffiliation.person_id == person.id,
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_ROLE,
            PersonAffiliation.role_key == ClassRoleKey.CLASS_REPRESENTATIVE,
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
        )
    )
    class_roles = list(result.all())
    if not class_roles:
        return

    council_position = await get_or_create_council_representative_position(session)
    if council_position is None:
        return

    for class_role in class_roles:
        await person_svc.create_affiliation(
            session,
            data=PersonAffiliationCreate(
                person_id=person.id,
                kind=PersonAffiliationKind.ORG_POSITION,
                position_id=council_position.id,
                start_date=class_role.start_date,
                end_date=class_role.end_date,
                source=PersonAffiliationSource.CLASS_WORKSPACE,
            ),
        )


async def get_or_create_council_representative_position(
    session: AsyncSession,
) -> Position | None:
    org = await session.scalar(select(Org).where(Org.name.in_(COUNCIL_ORG_NAMES)).limit(1))
    if org is None:
        return None
    position = await session.scalar(
        select(Position).where(
            Position.org_id == org.id,
            Position.name == COUNCIL_REPRESENTATIVE_POSITION_NAME,
        )
    )
    if position is None:
        position = Position(
            org_id=org.id,
            name=COUNCIL_REPRESENTATIVE_POSITION_NAME,
            category=PositionCategory.COUNCIL,
            weight=70,
        )
        session.add(position)
        await session.flush()
    existing_codes = await session.execute(
        select(Permission.code).where(Permission.position_id == position.id)
    )
    codes = set(existing_codes.scalars().all())
    for code in [
        "regulation:create",
        "regulation:submit",
        "document:create",
    ]:
        if code not in codes:
            session.add(Permission(position_id=position.id, code=code))
    await session.flush()
    return position


async def remove_manual_member(
    session: AsyncSession, class_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    result = await session.execute(
        select(ClassManualMember).where(
            ClassManualMember.class_id == class_id,
            ClassManualMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        return False
    await session.delete(member)
    await remove_cadre(session, class_id, user_id)
    await session.flush()
    return True


async def list_manual_members(session: AsyncSession, sc: SchoolClass) -> list[ClassManualMemberOut]:
    if not sc.manual_members:
        refreshed = await get_class(session, sc.id)
        sc = refreshed or sc
    return [ClassManualMemberOut.model_validate(member) for member in sc.manual_members]


def _user_in_class_ranges(user: User, sc: SchoolClass) -> bool:
    return any(
        student_id_in_range(user.student_id or "", rng.student_id_start, rng.student_id_end)
        for rng in sc.ranges
    )


async def _excluded_range_memberships(
    session: AsyncSession, *, class_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None
) -> set[tuple[uuid.UUID, uuid.UUID]]:
    """已結束且未重新加入的歸屬，優先於學號區間的自動推導。"""
    query = (
        select(PersonAffiliation, Person.user_id)
        .join(Person, Person.id == PersonAffiliation.person_id)
        .where(
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.class_id.is_not(None),
            Person.user_id.is_not(None),
        )
    )
    if class_id is not None:
        query = query.where(PersonAffiliation.class_id == class_id)
    if user_id is not None:
        query = query.where(Person.user_id == user_id)
    ended = set()
    active = set()
    today = local_today()
    for affiliation, linked_user_id in (await session.execute(query)).all():
        identity = (affiliation.class_id, linked_user_id)
        if affiliation.status == PersonAffiliationStatus.ENDED:
            ended.add(identity)
        elif (
            affiliation.status == PersonAffiliationStatus.ACTIVE
            and affiliation.start_date <= today
            and (affiliation.end_date is None or affiliation.end_date >= today)
        ):
            active.add(identity)
    return ended - active


async def remove_class_member(session: AsyncSession, sc: SchoolClass, member_id: uuid.UUID) -> bool:
    """以成員／人員／名冊 ID 轉出，清除當班來源並保留已結束的歸屬。"""
    target_person = await session.get(Person, member_id)
    member = next(
        (
            item
            for item in await list_class_members(session, sc)
            if item.id == member_id
            or item.roster_entry_id == member_id
            or (target_person and target_person.user_id and item.user_id == target_person.user_id)
        ),
        None,
    )
    if member is None:
        # 手動更正至別班的帳號可能仍有舊座號，仍允許清除指定班級的名冊。
        entry = await session.scalar(
            select(ClassRosterEntry).where(
                ClassRosterEntry.class_id == sc.id,
                (ClassRosterEntry.id == member_id) | (ClassRosterEntry.user_id == member_id),
            )
        )
        if entry is None:
            return False
        member = ClassMemberOut(
            id=entry.id,
            user_id=entry.user_id,
            roster_entry_id=entry.id,
            display_name="尚未登入同學",
            student_id=entry.student_id,
            email="",
        )
    user = await session.get(User, member.user_id) if member.user_id else None
    if user is not None:
        person = await person_svc.ensure_person_for_user(
            session, user, source=PersonAffiliationSource.CLASS_WORKSPACE
        )
    else:
        person = await session.get(Person, member.id)
        if person is None and member.student_id:
            person = await session.scalar(
                select(Person).where(Person.student_id == member.student_id)
            )
        if person is None:
            person = Person(student_id=member.student_id, display_name=member.display_name)
            session.add(person)
            await session.flush()
        if person.user_id is not None:
            user = await session.get(User, person.user_id)
    # 即使只有學號區間來源，也留下明確的轉出紀錄。
    await person_svc.create_affiliation(
        session,
        data=PersonAffiliationCreate(
            person_id=person.id,
            kind=PersonAffiliationKind.CLASS_MEMBER,
            class_id=sc.id,
            source=PersonAffiliationSource.CLASS_WORKSPACE,
        ),
    )
    affiliations = await session.scalars(
        select(PersonAffiliation).where(
            PersonAffiliation.person_id == person.id,
            PersonAffiliation.class_id == sc.id,
            PersonAffiliation.kind.in_(
                [PersonAffiliationKind.CLASS_MEMBER, PersonAffiliationKind.CLASS_ROLE]
            ),
            PersonAffiliation.status != PersonAffiliationStatus.ENDED,
        )
    )
    for affiliation in affiliations:
        affiliation.status = PersonAffiliationStatus.ENDED
        affiliation.end_date = (
            local_today() - timedelta(days=1)
            if affiliation.kind == PersonAffiliationKind.CLASS_ROLE
            else max(local_today(), affiliation.start_date)
        )
    entries = await session.scalars(
        select(ClassRosterEntry).where(
            ClassRosterEntry.class_id == sc.id,
            (ClassRosterEntry.user_id == user.id)
            | (ClassRosterEntry.student_id == member.student_id)
            if user
            else ClassRosterEntry.student_id == member.student_id,
        )
    )
    for entry in entries:
        await session.delete(entry)
    if user is not None:
        memberships = await session.scalars(
            select(ClassMembership).where(
                ClassMembership.class_id == sc.id,
                ClassMembership.user_id == user.id,
                ClassMembership.status == ClassMembershipStatus.ACTIVE,
            )
        )
        for membership in memberships:
            membership.status = ClassMembershipStatus.ENDED
            membership.end_date = max(local_today(), membership.start_date)
        manual = await session.scalar(
            select(ClassManualMember).where(
                ClassManualMember.class_id == sc.id, ClassManualMember.user_id == user.id
            )
        )
        if manual is not None:
            await session.delete(manual)
        await remove_cadre(session, sc.id, user.id)
        positions = await session.scalars(
            select(UserPosition)
            .join(ClassRoleBinding, ClassRoleBinding.position_id == UserPosition.position_id)
            .where(
                ClassRoleBinding.class_id == sc.id,
                UserPosition.user_id == user.id,
                (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= local_today()),
            )
        )
        for position in positions:
            # 任期迄日包含當日，轉出必須立即停止本班職位權限。
            position.end_date = local_today() - timedelta(days=1)
        from api.core.cache import cache_invalidate
        from api.services.discord_bot import enqueue_role_sync

        await cache_invalidate(f"perm:{user.id}")
        await enqueue_role_sync(session, user.id)
    await session.flush()
    await session.refresh(sc, attribute_names=["manual_members", "roster_entries", "cadres"])
    return True


async def is_class_member(session: AsyncSession, sc: SchoolClass, user: User) -> bool:
    if any(member.user_id == user.id for member in sc.manual_members):
        return True
    if any(
        entry.user_id == user.id or (entry.user_id is None and entry.student_id == user.student_id)
        for entry in sc.roster_entries
    ):
        return True
    if not sc.ranges:
        refreshed = await get_class(session, sc.id)
        sc = refreshed or sc
    excluded = await _excluded_range_memberships(session, class_id=sc.id, user_id=user.id)
    return (sc.id, user.id) not in excluded and _user_in_class_ranges(user, sc)


# ── 班級幹部 ──────────────────────────────────────────────────────────────────


async def add_cadre(session: AsyncSession, sc: SchoolClass, *, user_id: uuid.UUID) -> ClassCadre:
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("找不到此使用者")
    if any(c.user_id == user_id for c in sc.cadres):
        raise ValueError("此使用者已是該班幹部")
    if not await is_class_member(session, sc, user):
        raise ValueError("請先將此使用者加入班級，再設定為幹部")
    cadre = ClassCadre(user_id=user_id)
    sc.cadres.append(cadre)
    await session.flush()
    await session.refresh(cadre, attribute_names=["user"])
    person = await person_svc.ensure_person_for_user(
        session, user, source=PersonAffiliationSource.CLASS_WORKSPACE
    )
    await person_svc.create_affiliation(
        session,
        data=PersonAffiliationCreate(
            person_id=person.id,
            kind=PersonAffiliationKind.CLASS_ROLE,
            academic_year=sc.academic_year,
            class_id=sc.id,
            role_key="class_cadre",
            title="班級幹部",
            source=PersonAffiliationSource.CLASS_WORKSPACE,
        ),
    )
    return cadre


async def remove_cadre(session: AsyncSession, class_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    result = await session.execute(
        select(ClassCadre).where(ClassCadre.class_id == class_id, ClassCadre.user_id == user_id)
    )
    cadre = result.scalar_one_or_none()
    if cadre is None:
        return False
    await session.delete(cadre)
    await session.flush()
    return True


# ── 可重用 helper ─────────────────────────────────────────────────────────────


async def link_roster_accounts(
    session: AsyncSession, *, class_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None
) -> None:
    """補連名冊建立後才出現的帳號；保留既有連結及人工轉班結果。"""
    override_class = aliased(SchoolClass)
    manual_override = (
        select(ClassManualMember.id)
        .join(override_class, override_class.id == ClassManualMember.class_id)
        .where(
            ClassManualMember.user_id == User.id,
            override_class.academic_year == SchoolClass.academic_year,
            override_class.is_active.is_(True),
            ClassManualMember.class_id != ClassRosterEntry.class_id,
        )
        .exists()
    )
    query = (
        select(ClassRosterEntry, User)
        .join(User, User.student_id == ClassRosterEntry.student_id)
        .join(SchoolClass, SchoolClass.id == ClassRosterEntry.class_id)
        .where(ClassRosterEntry.user_id.is_(None), User.is_active.is_(True), ~manual_override)
    )
    if class_id is not None:
        query = query.where(ClassRosterEntry.class_id == class_id)
    if user_id is not None:
        query = query.where(User.id == user_id)
    for entry, user in (await session.execute(query)).all():
        entry.user_id = user.id
        entry.user = user
    await session.flush()


async def resolve_user_class(session: AsyncSession, user: User) -> SchoolClass | None:
    """依手動指派、人員歸屬、名冊、學號區間推導目前所屬的 active 班級。"""
    await link_roster_accounts(session, user_id=user.id)
    manual_result = await session.execute(
        select(SchoolClass)
        .join(ClassManualMember, ClassManualMember.class_id == SchoolClass.id)
        .options(selectinload(SchoolClass.ranges))
        .where(SchoolClass.is_active.is_(True), ClassManualMember.user_id == user.id)
        .order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    )
    manual_class = manual_result.scalars().first()
    if manual_class is not None:
        return manual_class
    today = local_today()
    affiliation_class = await session.scalar(
        select(SchoolClass)
        .join(PersonAffiliation, PersonAffiliation.class_id == SchoolClass.id)
        .join(Person, Person.id == PersonAffiliation.person_id)
        .options(selectinload(SchoolClass.ranges))
        .where(
            Person.user_id == user.id,
            SchoolClass.is_active.is_(True),
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.status == PersonAffiliationStatus.ACTIVE,
            PersonAffiliation.start_date <= today,
            (PersonAffiliation.end_date.is_(None)) | (PersonAffiliation.end_date >= today),
        )
        .order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    )
    if affiliation_class is not None:
        return affiliation_class
    roster_query = (
        select(SchoolClass)
        .join(
            ClassRosterEntry,
            ClassRosterEntry.class_id == SchoolClass.id,
        )
        .options(selectinload(SchoolClass.ranges))
        .where(SchoolClass.is_active.is_(True))
    )
    if user.student_id:
        roster_query = roster_query.where(
            (ClassRosterEntry.user_id == user.id)
            | (
                ClassRosterEntry.user_id.is_(None)
                & (ClassRosterEntry.student_id == user.student_id)
            )
        )
    else:
        roster_query = roster_query.where(ClassRosterEntry.user_id == user.id)
    roster_class = await session.scalar(
        roster_query.order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    )
    if roster_class is not None:
        return roster_class
    if not user.student_id:
        return None
    excluded = await _excluded_range_memberships(session, user_id=user.id)
    result = await session.execute(
        select(SchoolClass)
        .options(selectinload(SchoolClass.ranges))
        .where(SchoolClass.is_active.is_(True))
    )
    for sc in result.scalars().unique():
        if (sc.id, user.id) in excluded:
            continue
        for rng in sc.ranges:
            if student_id_in_range(user.student_id, rng.student_id_start, rng.student_id_end):
                return sc
    return None


async def get_user_class_seat_number(
    session: AsyncSession, school_class: SchoolClass, user: User
) -> int | None:
    """從指定班級名冊取得使用者座號。"""
    seat_number = await session.scalar(
        select(ClassRosterEntry.seat_number).where(
            ClassRosterEntry.class_id == school_class.id,
            ClassRosterEntry.user_id == user.id,
        )
    )
    if seat_number is not None or not user.student_id:
        return seat_number
    return await session.scalar(
        select(ClassRosterEntry.seat_number).where(
            ClassRosterEntry.class_id == school_class.id,
            ClassRosterEntry.student_id == user.student_id,
        )
    )


async def reassign_user_class(
    session: AsyncSession, user_id: uuid.UUID, school_class: SchoolClass
) -> None:
    """以手動歸戶更正帳號班級，並結束同學年度的舊名冊快照。"""
    if not school_class.is_active:
        raise ValueError("請選擇目前有效的班級")
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("找不到此使用者")

    today = local_today()
    memberships = await session.scalars(
        select(ClassMembership).where(
            ClassMembership.user_id == user_id,
            ClassMembership.academic_year == school_class.academic_year,
            ClassMembership.status == ClassMembershipStatus.ACTIVE,
        )
    )
    for membership in memberships:
        membership.status = ClassMembershipStatus.ENDED
        membership.end_date = today

    affiliations = await session.scalars(
        select(PersonAffiliation)
        .join(Person, Person.id == PersonAffiliation.person_id)
        .where(
            Person.user_id == user_id,
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.academic_year == school_class.academic_year,
            PersonAffiliation.status == PersonAffiliationStatus.ACTIVE,
        )
    )
    for affiliation in affiliations:
        affiliation.status = PersonAffiliationStatus.ENDED
        affiliation.end_date = today

    manual_members = await session.scalars(
        select(ClassManualMember)
        .join(SchoolClass, SchoolClass.id == ClassManualMember.class_id)
        .where(
            ClassManualMember.user_id == user_id,
            SchoolClass.academic_year == school_class.academic_year,
            SchoolClass.is_active.is_(True),
        )
    )
    has_target_manual_member = False
    for member in manual_members:
        if member.class_id == school_class.id:
            has_target_manual_member = True
        else:
            await session.delete(member)
    if not has_target_manual_member:
        session.add(ClassManualMember(class_id=school_class.id, user_id=user_id))

    roster_entries = await session.scalars(
        select(ClassRosterEntry)
        .join(SchoolClass, SchoolClass.id == ClassRosterEntry.class_id)
        .where(
            ClassRosterEntry.user_id == user_id,
            SchoolClass.academic_year == school_class.academic_year,
            SchoolClass.is_active.is_(True),
            ClassRosterEntry.class_id != school_class.id,
        )
    )
    for entry in roster_entries:
        entry.user_id = None

    await session.flush()
    await add_membership(
        session,
        school_class,
        data=ClassMembershipCreate(user_id=user_id, source="transfer", start_date=today),
    )
    await session.flush()


async def get_cadre_class_ids(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """回傳該使用者可代表處理班級事項的所有班級 ID。"""
    result = await session.execute(select(ClassCadre.class_id).where(ClassCadre.user_id == user_id))
    class_ids = set(result.scalars().all())
    today = local_today()
    role_result = await session.execute(
        select(ClassRoleBinding.class_id)
        .join(Position, Position.id == ClassRoleBinding.position_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            *active_tenure_filter(today),
        )
    )
    class_ids.update(role_result.scalars().all())
    return class_ids


async def list_class_members(session: AsyncSession, sc: SchoolClass) -> list[ClassMemberOut]:
    """合併座號名冊、人員、手動成員與學號區間，包含尚未登入的同學。"""
    roster_entries = await list_roster_entries(session, sc)
    roster_people = {
        person.student_id: person
        for person in await session.scalars(
            select(Person)
            .options(selectinload(Person.user))
            .where(Person.student_id.in_([entry.student_id for entry in roster_entries]))
        )
    }
    roster_users = {entry.student_id: entry.user for entry in roster_entries if entry.user}
    cadre_ids = {c.user_id for c in sc.cadres}
    members_by_id: dict[uuid.UUID, ClassMemberOut] = {}
    member_ids_by_student_id: dict[str, uuid.UUID] = {}
    affiliation_result = await session.execute(
        select(PersonAffiliation)
        .options(selectinload(PersonAffiliation.person).selectinload(Person.user))
        .where(
            PersonAffiliation.class_id == sc.id,
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.status == PersonAffiliationStatus.ACTIVE,
            PersonAffiliation.start_date <= local_today(),
            (PersonAffiliation.end_date.is_(None)) | (PersonAffiliation.end_date >= local_today()),
        )
    )
    for affiliation in affiliation_result.scalars().all():
        person = affiliation.person
        if person is None:
            continue
        user = person.user or roster_users.get(person.student_id or "")
        member_id = user.id if user else person.id
        member_ids_by_student_id[person.student_id or ""] = member_id
        display_name = user.display_name if user else person.display_name
        email = user.email if user else person.email or ""
        members_by_id[member_id] = ClassMemberOut(
            id=member_id,
            user_id=user.id if user else None,
            display_name=display_name,
            student_id=person.student_id,
            email=email,
            is_cadre=user.id in cadre_ids if user else False,
            source="person_affiliation",
        )
    for member in sc.manual_members:
        if member.user is None:
            continue
        members_by_id[member.user_id] = ClassMemberOut(
            id=member.user.id,
            user_id=member.user.id,
            display_name=member.user.display_name,
            student_id=member.user.student_id,
            email=member.user.email,
            is_cadre=member.user_id in cadre_ids,
            source="manual",
            manual_member_id=member.id,
        )
    for entry in roster_entries:
        person = roster_people.get(entry.student_id)
        user = entry.user or (person.user if person else None)
        member_id = user.id if user else member_ids_by_student_id.get(entry.student_id, entry.id)
        if member_id in members_by_id:
            members_by_id[member_id].seat_number = entry.seat_number
            members_by_id[member_id].roster_entry_id = entry.id
            continue
        members_by_id[member_id] = ClassMemberOut(
            id=member_id,
            user_id=user.id if user else None,
            roster_entry_id=entry.id,
            display_name=(
                user.display_name if user else person.display_name if person else "尚未登入同學"
            ),
            student_id=entry.student_id,
            email=user.email if user else "",
            seat_number=entry.seat_number,
            is_cadre=user.id in cadre_ids if user else False,
            source="roster",
        )
    excluded = await _excluded_range_memberships(session, class_id=sc.id)
    result = await session.execute(select(User).where(User.student_id.is_not(None)))
    for u in result.scalars():
        if u.id in members_by_id or (sc.id, u.id) in excluded or not _user_in_class_ranges(u, sc):
            continue
        members_by_id[u.id] = ClassMemberOut(
            id=u.id,
            user_id=u.id,
            display_name=u.display_name,
            student_id=u.student_id,
            email=u.email,
            is_cadre=u.id in cadre_ids,
            source="range",
        )

    manual_overrides = await session.scalars(
        select(ClassManualMember.user_id)
        .join(SchoolClass, SchoolClass.id == ClassManualMember.class_id)
        .where(
            SchoolClass.is_active.is_(True),
            SchoolClass.academic_year == sc.academic_year,
            ClassManualMember.class_id != sc.id,
        )
    )
    for user_id in manual_overrides:
        members_by_id.pop(user_id, None)

    members = list(members_by_id.values())
    members.sort(key=lambda m: (m.seat_number is None, m.seat_number or 0, m.student_id or ""))
    return members


async def prepare_roster_order_recipient(
    session: AsyncSession,
    *,
    roster_entry_id: uuid.UUID,
    actor: User,
    allow_all_classes: bool = False,
    product_ids: list[uuid.UUID] | None = None,
) -> tuple[User, SchoolClass]:
    """代購時才預建帳號；跨班操作須由 router 確認訂單管理權限。"""
    from api.services.user_registration import pre_register_user

    entry = await session.scalar(
        select(ClassRosterEntry).where(ClassRosterEntry.id == roster_entry_id).with_for_update()
    )
    if entry is None:
        raise LookupError("找不到此座號名冊資料")
    sc = await session.get(SchoolClass, entry.class_id)
    cadre_ids = await get_cadre_class_ids(session, actor.id)
    if (
        sc is None
        or not sc.is_active
        or (not allow_all_classes and not actor.is_superuser and sc.id not in cadre_ids)
    ):
        raise PermissionError("無權替此學生訂購")

    person = await session.scalar(select(Person).where(Person.student_id == entry.student_id))
    user = await session.get(User, entry.user_id) if entry.user_id else None
    if user is None and person is not None and person.user_id is not None:
        user = await session.get(User, person.user_id)
    if user is None:
        user = await session.scalar(select(User).where(User.student_id == entry.student_id))
    if user is None:
        # 預建帳號會持有稽核鏈交易鎖。先依固定順序鎖住本次商品，避免
        # 與「持有商品鎖、等待稽核鎖」的訂單交易形成循環等待。
        from api.models.shop import Product

        if product_ids:
            await session.execute(
                select(Product.id)
                .where(Product.id.in_(product_ids))
                .order_by(Product.id)
                .with_for_update()
            )
        user = await pre_register_user(
            session,
            student_id=entry.student_id,
            email=None,
            linked_emails=[],
            display_name=person.display_name if person else f"{entry.seat_number} 號同學",
            position_ids=[],
            custom_permission_org_id=None,
            custom_permission_codes=[],
            start_date=local_today(),
            end_date=None,
            actor=actor,
        )
    if not user.is_active:
        raise PermissionError("此學生帳號已停用")
    entry.user_id = user.id
    await session.flush()
    target_class = await resolve_user_class(session, user)
    if target_class is None or target_class.id != sc.id:
        raise PermissionError("此學生目前不屬於本班")
    await person_svc.ensure_person_for_user(session, user)
    return user, sc
