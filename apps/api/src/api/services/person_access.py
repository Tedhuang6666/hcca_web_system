"""人員資料的權限範圍查詢與比對。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from http import HTTPStatus

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.permission_codes import PermissionCode
from api.models.org import Org, Position
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationStatus,
)
from api.models.school_class import ClassRoleBinding, SchoolClass
from api.models.user import User
from api.schemas.person import PersonAffiliationCreate, PersonRosterImport
from api.services.permission import (
    get_position_granted_permission_codes,
    get_user_org_ids_with_permission,
    get_user_permission_codes,
)


@dataclass(frozen=True)
class PeopleAccessScope:
    # 組織成員管理權涵蓋組織歸屬；班級管理權只涵蓋指定組織內的班級。
    org_ids: frozenset[uuid.UUID] | None
    class_ids: frozenset[uuid.UUID] | None
    manageable_class_ids: frozenset[uuid.UUID] | None
    class_org_by_id: dict[uuid.UUID, uuid.UUID | None] | None

    @property
    def is_global(self) -> bool:
        return self.org_ids is None and self.class_ids is None

    @property
    def visible_org_ids(self) -> frozenset[uuid.UUID] | None:
        if self.org_ids is None or self.class_org_by_id is None:
            return None
        return frozenset(
            self.org_ids | {org_id for org_id in self.class_org_by_id.values() if org_id}
        )


async def affiliation_grant_error(
    db: AsyncSession, payload: PersonAffiliationCreate, actor: User
) -> tuple[HTTPStatus, str] | None:
    """Validate that a user may grant the position requested by an affiliation."""
    position_id = payload.position_id
    if payload.kind == PersonAffiliationKind.CLASS_ROLE:
        binding_id = (
            await db.scalar(
                select(ClassRoleBinding.position_id).where(
                    ClassRoleBinding.class_id == payload.class_id,
                    ClassRoleBinding.role_key == payload.role_key,
                )
            )
            if payload.role_key
            else None
        )
        if position_id is not None and (binding_id is None or binding_id != position_id):
            return HTTPStatus.UNPROCESSABLE_ENTITY, "班級職位須符合既有角色綁定"
        position_id = position_id or binding_id
    elif position_id is not None and payload.kind != PersonAffiliationKind.ORG_POSITION:
        return HTTPStatus.UNPROCESSABLE_ENTITY, "此身分類型不可指派職位"

    if position_id is None:
        return None
    position = await db.get(Position, position_id)
    if position is None:
        return HTTPStatus.UNPROCESSABLE_ENTITY, "找不到職位"
    org = await db.get(Org, position.org_id)
    if org is None or not org.is_active:
        return HTTPStatus.CONFLICT, "職位所屬組織已停用"
    if payload.org_id is not None and payload.org_id != position.org_id:
        return HTTPStatus.UNPROCESSABLE_ENTITY, "職位與身分所屬組織不一致"
    if payload.kind == PersonAffiliationKind.CLASS_ROLE:
        school_class = await db.get(SchoolClass, payload.class_id)
        if school_class is None or school_class.org_id != position.org_id:
            return HTTPStatus.UNPROCESSABLE_ENTITY, "班級職位與班級所屬組織不一致"

    if actor.is_superuser:
        return None
    actor_codes = await get_user_permission_codes(db, actor.id)
    if PermissionCode.ADMIN_ALL in actor_codes:
        return None
    granted_codes = await get_position_granted_permission_codes(db, position)
    if PermissionCode.ADMIN_ALL in granted_codes or not granted_codes.issubset(actor_codes):
        return HTTPStatus.FORBIDDEN, "不可指派超出自身權限的職位"
    return None


async def get_people_access_scope(db: AsyncSession, actor: User) -> PeopleAccessScope:
    codes = await get_user_permission_codes(db, actor.id)
    if (
        actor.is_superuser
        or {
            PermissionCode.ADMIN_ALL.value,
            PermissionCode.ADMIN_USERS.value,
        }
        & codes
    ):
        return PeopleAccessScope(
            org_ids=None,
            class_ids=None,
            manageable_class_ids=None,
            class_org_by_id=None,
        )

    org_ids = set(
        await get_user_org_ids_with_permission(
            db, actor.id, PermissionCode.ORG_MANAGE_MEMBERS.value
        )
    )
    class_permission_org_ids = set(
        await get_user_org_ids_with_permission(db, actor.id, PermissionCode.CLASS_MANAGE.value)
    )
    scoped_org_ids = org_ids | class_permission_org_ids
    class_rows = (
        await db.execute(
            select(SchoolClass.id, SchoolClass.org_id).where(
                SchoolClass.org_id.in_(scoped_org_ids),
                SchoolClass.is_active.is_(True),
            )
        )
        if scoped_org_ids
        else None
    )
    class_org_by_id = dict(class_rows.all()) if class_rows is not None else {}
    manageable_class_ids = frozenset(
        class_id
        for class_id, org_id in class_org_by_id.items()
        if org_id in class_permission_org_ids
    )
    return PeopleAccessScope(
        org_ids=frozenset(org_ids),
        class_ids=frozenset(class_org_by_id),
        manageable_class_ids=manageable_class_ids,
        class_org_by_id=class_org_by_id,
    )


def scope_affiliation_filter(scope: PeopleAccessScope):
    scope_filters = []
    if scope.org_ids:
        scope_filters.append(
            and_(
                PersonAffiliation.org_id.in_(scope.org_ids),
                PersonAffiliation.class_id.is_(None),
            )
        )
    if scope.class_ids:
        class_org_id = (
            select(SchoolClass.org_id)
            .where(SchoolClass.id == PersonAffiliation.class_id)
            .scalar_subquery()
        )
        scope_filters.append(
            and_(
                PersonAffiliation.class_id.in_(scope.class_ids),
                or_(PersonAffiliation.org_id.is_(None), PersonAffiliation.org_id == class_org_id),
            )
        )
    return or_(*scope_filters) if scope_filters else False


async def person_has_access_scope(
    db: AsyncSession, person_id: uuid.UUID, scope: PeopleAccessScope
) -> bool:
    if scope.is_global:
        return True
    affiliation_id = await db.scalar(
        select(PersonAffiliation.id)
        .where(
            PersonAffiliation.person_id == person_id,
            scope_affiliation_filter(scope),
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
        )
        .limit(1)
    )
    return affiliation_id is not None


async def affiliation_has_access_scope(
    db: AsyncSession, affiliation: PersonAffiliation, scope: PeopleAccessScope
) -> bool:
    if scope.is_global:
        return True
    class_org_id = (
        scope.class_org_by_id.get(affiliation.class_id)
        if affiliation.class_id is not None and scope.class_org_by_id is not None
        else None
    )
    class_scope = affiliation.class_id is not None and affiliation.class_id in (
        scope.manageable_class_ids or set()
    )
    if class_scope and affiliation.org_id is not None and affiliation.org_id != class_org_id:
        class_scope = False
    org_scope = affiliation.class_id is None and affiliation.org_id in (scope.org_ids or set())
    position_org_id = None
    if affiliation.position_id is not None:
        position_org_id = await db.scalar(
            select(Position.org_id).where(Position.id == affiliation.position_id)
        )
    position_matches_scope = (
        affiliation.position_id is None
        or (org_scope and position_org_id == affiliation.org_id)
        or (class_scope and position_org_id == class_org_id)
    )
    return (org_scope or class_scope) and position_matches_scope


async def new_affiliation_has_access_scope(
    db: AsyncSession, payload: PersonAffiliationCreate, scope: PeopleAccessScope
) -> bool:
    if scope.is_global:
        return True
    has_scope = False
    class_org_id = (
        scope.class_org_by_id.get(payload.class_id)
        if payload.class_id is not None and scope.class_org_by_id is not None
        else None
    )
    class_scope = payload.class_id is not None and payload.class_id in (
        scope.manageable_class_ids or set()
    )
    if class_scope and payload.org_id is not None and payload.org_id != class_org_id:
        return False
    if payload.org_id is not None:
        has_scope = True
        if payload.class_id is None and payload.org_id not in (scope.org_ids or set()):
            return False
    if payload.class_id is not None:
        has_scope = True
        if not class_scope:
            return False
    if payload.position_id is not None:
        has_scope = True
        position_org_id = await db.scalar(
            select(Position.org_id).where(Position.id == payload.position_id)
        )
        position_allowed = (
            position_org_id == class_org_id
            if payload.class_id is not None
            else position_org_id in (scope.org_ids or set())
        )
        if not position_allowed:
            return False
    return has_scope


def roster_classes_have_access_scope(payload: PersonRosterImport, scope: PeopleAccessScope) -> bool:
    manageable_class_ids = scope.manageable_class_ids or set()
    return all(
        row.class_id is not None and row.class_id in manageable_class_ids for row in payload.rows
    )


async def existing_roster_people_have_access_scope(
    db: AsyncSession, payload: PersonRosterImport, scope: PeopleAccessScope
) -> bool:
    student_ids = {row.student_id for row in payload.rows}
    existing_people = await db.execute(
        select(Person.id, Person.student_id).where(Person.student_id.in_(student_ids))
    )
    existing_by_student_id = {student_id: person_id for person_id, student_id in existing_people}
    if not existing_by_student_id:
        return True
    in_scope_person_ids = set(
        (
            await db.scalars(
                select(PersonAffiliation.person_id)
                .where(
                    PersonAffiliation.person_id.in_(set(existing_by_student_id.values())),
                    scope_affiliation_filter(scope),
                    PersonAffiliation.status.in_(
                        [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
                    ),
                )
                .distinct()
            )
        ).all()
    )
    return set(existing_by_student_id.values()) <= in_scope_person_ids


async def list_scope_classes(db: AsyncSession, scope: PeopleAccessScope) -> list[SchoolClass]:
    if not scope.class_ids:
        return []
    class_rows = await db.scalars(
        select(SchoolClass)
        .where(SchoolClass.id.in_(scope.class_ids))
        .order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
    )
    return list(class_rows.all())


def scope_affiliation_filters(
    *,
    org_ids: set[uuid.UUID] | None,
    class_ids: set[uuid.UUID] | None,
):
    if org_ids is None and class_ids is None:
        return []

    scope_filters = []
    if org_ids:
        scope_filters.append(
            (PersonAffiliation.org_id.in_(org_ids)) & PersonAffiliation.class_id.is_(None)
        )
    if class_ids:
        class_org_id = (
            select(SchoolClass.org_id)
            .where(SchoolClass.id == PersonAffiliation.class_id)
            .scalar_subquery()
        )
        scope_filters.append(
            (PersonAffiliation.class_id.in_(class_ids))
            & or_(PersonAffiliation.org_id.is_(None), PersonAffiliation.org_id == class_org_id)
        )
    return [or_(*scope_filters)] if scope_filters else [False]


def scoped_person_ids_query(
    *,
    org_ids: set[uuid.UUID] | None,
    class_ids: set[uuid.UUID] | None,
):
    """依有效組織／班級身分回傳可檢視的人員 ID。None 代表不套用範圍。"""
    if org_ids is None and class_ids is None:
        return select(Person.id)

    return (
        select(PersonAffiliation.person_id)
        .join(Person, Person.id == PersonAffiliation.person_id)
        .where(
            *scope_affiliation_filters(org_ids=org_ids, class_ids=class_ids),
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
        )
        .distinct()
    )


def affiliation_matches_scope(
    affiliation: PersonAffiliation,
    *,
    org_ids: set[uuid.UUID] | None,
    class_ids: set[uuid.UUID] | None,
) -> bool:
    if org_ids is None and class_ids is None:
        return True
    if affiliation.class_id is None:
        return org_ids is not None and affiliation.org_id in org_ids
    if class_ids is None or affiliation.class_id not in class_ids:
        return False
    class_org_id = affiliation.school_class.org_id if affiliation.school_class else None
    return affiliation.org_id is None or affiliation.org_id == class_org_id
