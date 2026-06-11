"""班級系統服務層 - 班級 CRUD / 學號區間 / 幹部 / 自動歸班

可重用 helper（resolve_user_class / get_cadre_class_ids / list_class_members）
供商品系統與日後學餐系統共用「依班級歸戶、幹部結單」制度。
"""

from __future__ import annotations

import re
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.org import Org, Permission, Position, PositionCategory, UserPosition
from api.models.person import (
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
        ["class:view_members", "class:shop_collect", "class:meal_collect", "class:meal_pickup"],
        80,
    ),
    ClassRoleKey.VICE_LEADER: (
        "副班長",
        ["class:view_members", "class:shop_collect", "class:meal_collect", "class:meal_pickup"],
        70,
    ),
    ClassRoleKey.CLASS_REPRESENTATIVE: (
        "班代",
        [
            "class:view_members",
            "meeting:vote",
            "meeting:view_all",
            "regulation:create",
            "regulation:submit",
            "document:create",
        ],
        90,
    ),
    ClassRoleKey.DISCIPLINE: ("風紀", ["class:view_members"], 40),
    ClassRoleKey.LUNCH_MANAGER: (
        "午餐股長",
        ["class:view_members", "class:meal_collect", "class:meal_close", "class:meal_pickup"],
        60,
    ),
    ClassRoleKey.TREASURER: (
        "總務/收款",
        ["class:view_members", "class:shop_collect", "class:meal_collect"],
        60,
    ),
    ClassRoleKey.GENERAL_AFFAIRS: ("事務", ["class:view_members"], 40),
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
    q = select(SchoolClass).options(
        selectinload(SchoolClass.ranges),
        selectinload(SchoolClass.manual_members).selectinload(ClassManualMember.user),
        selectinload(SchoolClass.cadres).selectinload(ClassCadre.user),
        selectinload(SchoolClass.memberships).selectinload(ClassMembership.user),
        selectinload(SchoolClass.role_bindings),
    )
    if academic_year is not None:
        q = q.where(SchoolClass.academic_year == academic_year)
    if is_active is not None:
        q = q.where(SchoolClass.is_active == is_active)
    q = q.order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


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
    bindings: list[ClassRoleBinding] = []
    for role_key, (title, codes, weight) in CLASS_ROLE_DEFINITIONS.items():
        if role_key in existing:
            bindings.append(existing[role_key])
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
    rows: list[dict] = []
    for binding in result.scalars().all():
        holders_result = await session.execute(
            select(UserPosition)
            .options(selectinload(UserPosition.user))
            .where(
                UserPosition.position_id == binding.position_id,
                UserPosition.start_date <= today,
                (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today),
            )
            .order_by(UserPosition.start_date.desc())
        )
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
            for up in holders_result.scalars().all()
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
        "meeting:vote",
        "meeting:view_all",
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


async def is_class_member(session: AsyncSession, sc: SchoolClass, user: User) -> bool:
    if any(member.user_id == user.id for member in sc.manual_members):
        return True
    if not sc.ranges:
        refreshed = await get_class(session, sc.id)
        sc = refreshed or sc
    return _user_in_class_ranges(user, sc)


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


async def resolve_user_class(session: AsyncSession, user: User) -> SchoolClass | None:
    """依手動指派優先，其次從 active 班級的學號區間推導所屬班級。"""
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
    if not user.student_id:
        return None
    result = await session.execute(
        select(SchoolClass)
        .options(selectinload(SchoolClass.ranges))
        .where(SchoolClass.is_active.is_(True))
    )
    for sc in result.scalars().unique():
        for rng in sc.ranges:
            if student_id_in_range(user.student_id, rng.student_id_start, rng.student_id_end):
                return sc
    return None


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
    """依手動成員與學號區間列出班級成員，並標示是否為幹部。"""
    cadre_ids = {c.user_id for c in sc.cadres}
    members_by_id: dict[uuid.UUID, ClassMemberOut] = {}
    affiliation_result = await session.execute(
        select(PersonAffiliation)
        .options(selectinload(PersonAffiliation.person))
        .where(
            PersonAffiliation.class_id == sc.id,
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.status == PersonAffiliationStatus.ACTIVE,
        )
    )
    for affiliation in affiliation_result.scalars().all():
        person = affiliation.person
        if person is None:
            continue
        member_id = person.user_id or person.id
        members_by_id[member_id] = ClassMemberOut(
            id=member_id,
            display_name=person.display_name,
            student_id=person.student_id,
            email=person.email or "",
            is_cadre=person.user_id in cadre_ids if person.user_id else False,
            source="person_affiliation",
        )
    for member in sc.manual_members:
        if member.user is None:
            continue
        members_by_id[member.user_id] = ClassMemberOut(
            id=member.user.id,
            display_name=member.user.display_name,
            student_id=member.user.student_id,
            email=member.user.email,
            is_cadre=member.user_id in cadre_ids,
            source="manual",
            manual_member_id=member.id,
        )
    result = await session.execute(select(User).where(User.student_id.is_not(None)))
    for u in result.scalars():
        if u.id in members_by_id or not _user_in_class_ranges(u, sc):
            continue
        members_by_id[u.id] = ClassMemberOut(
            id=u.id,
            display_name=u.display_name,
            student_id=u.student_id,
            email=u.email,
            is_cadre=u.id in cadre_ids,
            source="range",
        )
    members = list(members_by_id.values())
    members.sort(key=lambda m: m.student_id or "")
    return members
