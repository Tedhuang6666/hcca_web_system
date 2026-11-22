"""人員主檔與身分歸屬 Router。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any, require_permission
from api.models.org import Position
from api.models.person import Person, PersonAffiliation, PersonAffiliationStatus, PersonStatus
from api.models.school_class import SchoolClass
from api.models.user import User
from api.routers._common import or_404
from api.schemas.person import (
    PeopleAccessClassOut,
    PeopleAccessScopeOut,
    PersonAffiliationCreate,
    PersonAffiliationOut,
    PersonAffiliationUpdate,
    PersonCreate,
    PersonDetailOut,
    PersonDirectoryStats,
    PersonListItem,
    PersonOut,
    PersonRosterImport,
    PersonRosterImportResult,
    PersonUpdate,
)
from api.services import audit as audit_svc
from api.services import person as person_svc
from api.services.permission import get_user_org_ids_with_permission, get_user_permission_codes

router = APIRouter(prefix="/people", tags=["人員與身分"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
PeopleManager = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.ADMIN_ALL,
            PermissionCode.ADMIN_USERS,
            PermissionCode.CLASS_MANAGE,
            PermissionCode.ORG_MANAGE_MEMBERS,
        )
    ),
]
AdminUser = Annotated[User, Depends(require_permission(PermissionCode.ADMIN_ALL))]


@dataclass(frozen=True)
class PeopleAccessScope:
    # 組織成員管理權直接涵蓋組織歸屬；班級管理權只涵蓋指定組織內的班級。
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


async def _get_people_access_scope(db: AsyncSession, actor: User) -> PeopleAccessScope:
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


def _scope_affiliation_filter(scope: PeopleAccessScope):
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


async def _require_person_scope(
    db: AsyncSession, person_id: uuid.UUID, scope: PeopleAccessScope
) -> None:
    if scope.is_global:
        return
    affiliation_id = await db.scalar(
        select(PersonAffiliation.id)
        .where(
            PersonAffiliation.person_id == person_id,
            _scope_affiliation_filter(scope),
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
        )
        .limit(1)
    )
    if affiliation_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到人員主檔")


async def _require_affiliation_scope(
    db: AsyncSession, affiliation: PersonAffiliation, scope: PeopleAccessScope
) -> None:
    if scope.is_global:
        return
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
    if not (org_scope or class_scope) or not position_matches_scope:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到身分紀錄")


async def _require_new_affiliation_scope(
    db: AsyncSession, payload: PersonAffiliationCreate, scope: PeopleAccessScope
) -> None:
    if scope.is_global:
        return
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到目標身分範圍")
    if payload.org_id is not None:
        has_scope = True
        if payload.class_id is None and payload.org_id not in (scope.org_ids or set()):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到目標身分範圍")
    if payload.class_id is not None:
        has_scope = True
        if not class_scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到目標身分範圍")
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
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到目標身分範圍")
    if not has_scope:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到目標身分範圍")


async def _require_roster_import_scope(
    db: AsyncSession, payload: PersonRosterImport, scope: PeopleAccessScope
) -> None:
    if scope.is_global:
        return
    student_ids = {row.student_id for row in payload.rows}
    if any(
        row.class_id is None or row.class_id not in (scope.manageable_class_ids or set())
        for row in payload.rows
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="只能匯入管理範圍內的班級名冊"
        )

    existing_people = await db.execute(
        select(Person.id, Person.student_id).where(Person.student_id.in_(student_ids))
    )
    existing_by_student_id = {student_id: person_id for person_id, student_id in existing_people}
    if not existing_by_student_id:
        return
    in_scope_person_ids = set(
        (
            await db.scalars(
                select(PersonAffiliation.person_id)
                .where(
                    PersonAffiliation.person_id.in_(set(existing_by_student_id.values())),
                    _scope_affiliation_filter(scope),
                    PersonAffiliation.status.in_(
                        [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
                    ),
                )
                .distinct()
            )
        ).all()
    )
    if not set(existing_by_student_id.values()) <= in_scope_person_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="名冊包含管理範圍外的既有人員，請由全域管理者處理",
        )


async def _get_person_or_404(db: AsyncSession, person_id: uuid.UUID) -> Person:
    person = await person_svc.get_person(db, person_id)
    return or_404(person, "找不到人員主檔")


async def _get_affiliation_or_404(db: AsyncSession, affiliation_id: uuid.UUID) -> PersonAffiliation:
    affiliation = await db.get(PersonAffiliation, affiliation_id)
    return or_404(affiliation, "找不到身分紀錄")


@router.get("", response_model=list[PersonListItem], summary="搜尋人員主檔")
async def list_people(
    db: DbDep,
    actor: PeopleManager,
    keyword: str | None = Query(None, description="姓名、學號、Email"),
    class_id: uuid.UUID | None = Query(None, description="班級 ID"),
    org_id: uuid.UUID | None = Query(None, description="組織 ID"),
    position_id: uuid.UUID | None = Query(None, description="職位 ID"),
    status_filter: PersonStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[PersonListItem]:
    scope = await _get_people_access_scope(db, actor)
    if scope.is_global and not keyword and offset == 0:
        await person_svc.sync_people_from_existing_data(db)
    return await person_svc.list_people(
        db,
        keyword=keyword,
        class_id=class_id,
        org_id=org_id,
        position_id=position_id,
        status=status_filter,
        limit=limit,
        offset=offset,
        scope_org_ids=set(scope.org_ids) if scope.org_ids is not None else None,
        scope_class_ids=set(scope.class_ids) if scope.class_ids is not None else None,
    )


@router.get("/stats", response_model=PersonDirectoryStats, summary="取得範圍內帳號與人員統計")
async def get_people_stats(
    db: DbDep,
    actor: PeopleManager,
    keyword: str | None = Query(None, description="姓名、學號、Email"),
    class_id: uuid.UUID | None = Query(None, description="班級 ID"),
    status_filter: PersonStatus | None = Query(None, alias="status"),
) -> PersonDirectoryStats:
    scope = await _get_people_access_scope(db, actor)
    return await person_svc.get_directory_stats(
        db,
        keyword=keyword,
        class_id=class_id,
        status=status_filter,
        scope_org_ids=set(scope.org_ids) if scope.org_ids is not None else None,
        scope_class_ids=set(scope.class_ids) if scope.class_ids is not None else None,
    )


@router.get(
    "/access-scope",
    response_model=PeopleAccessScopeOut,
    summary="取得目前人員管理範圍",
)
async def read_people_access_scope(db: DbDep, actor: PeopleManager) -> PeopleAccessScopeOut:
    scope = await _get_people_access_scope(db, actor)
    classes = []
    if scope.class_ids:
        class_rows = await db.scalars(
            select(SchoolClass)
            .where(SchoolClass.id.in_(scope.class_ids))
            .order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
        )
        classes = [PeopleAccessClassOut.model_validate(row) for row in class_rows]
    return PeopleAccessScopeOut(
        is_global=scope.is_global,
        org_ids=sorted(scope.visible_org_ids, key=str)
        if scope.visible_org_ids is not None
        else None,
        class_ids=sorted(scope.class_ids, key=str) if scope.class_ids is not None else None,
        classes=classes,
    )


@router.post(
    "",
    response_model=PersonOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立人員主檔",
)
async def create_person(payload: PersonCreate, db: DbDep, actor: PeopleManager) -> Person:
    scope = await _get_people_access_scope(db, actor)
    if not scope.is_global:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="建立未歸屬人員主檔需全域使用者管理權限",
        )
    try:
        person = await person_svc.create_person(db, data=payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="人員資料已存在") from exc
    await audit_svc.record(
        db,
        entity_type="person",
        entity_id=str(person.id),
        action="person.create",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=payload.model_dump(mode="json"),
        summary=f"建立人員主檔「{person.display_name}」",
    )
    return person


@router.post(
    "/import-roster",
    response_model=PersonRosterImportResult,
    summary="匯入全體學生/分班名單",
)
async def import_roster(
    payload: PersonRosterImport, db: DbDep, actor: PeopleManager
) -> PersonRosterImportResult:
    scope = await _get_people_access_scope(db, actor)
    await _require_roster_import_scope(db, payload, scope)
    result = await person_svc.import_roster(
        db,
        data=payload,
        update_existing_fields=scope.is_global,
    )
    await audit_svc.record(
        db,
        entity_type="person",
        entity_id="roster-import",
        action="person.roster_import",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=result.model_dump(mode="json"),
        summary=f"匯入學生名冊 {result.total} 筆",
    )
    return result


@router.get("/{person_id}", response_model=PersonDetailOut, summary="取得人員詳情")
async def get_person(person_id: uuid.UUID, db: DbDep, actor: PeopleManager) -> PersonDetailOut:
    scope = await _get_people_access_scope(db, actor)
    await _require_person_scope(db, person_id, scope)
    person = await _get_person_or_404(db, person_id)
    detail = person_svc.person_to_detail(person)
    if not scope.is_global:
        detail.affiliations = [
            affiliation
            for affiliation in detail.affiliations
            if (
                affiliation.class_id is not None
                and scope.class_org_by_id is not None
                and affiliation.class_id in scope.class_org_by_id
                and affiliation.org_id in (None, scope.class_org_by_id[affiliation.class_id])
            )
            or (affiliation.class_id is None and affiliation.org_id in (scope.org_ids or set()))
        ]
    detail.class_roster = await person_svc.class_roster_for_identity(
        db,
        user_id=person.user_id,
        student_id=person.student_id,
    )
    if not scope.is_global:
        detail.class_roster = [
            row for row in detail.class_roster if row.class_id in (scope.class_ids or set())
        ]
    return detail


@router.patch("/{person_id}", response_model=PersonOut, summary="更新人員主檔")
async def update_person(
    person_id: uuid.UUID,
    payload: PersonUpdate,
    db: DbDep,
    actor: PeopleManager,
) -> Person:
    scope = await _get_people_access_scope(db, actor)
    await _require_person_scope(db, person_id, scope)
    if not scope.is_global:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="修改共用人員主檔欄位需全域使用者管理權限",
        )
    person = await _get_person_or_404(db, person_id)
    person = await person_svc.update_person(db, person, data=payload)
    await audit_svc.record(
        db,
        entity_type="person",
        entity_id=str(person.id),
        action="person.update",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=payload.model_dump(mode="json", exclude_unset=True),
        summary=f"更新人員主檔「{person.display_name}」",
    )
    return person


@router.post(
    "/affiliations",
    response_model=PersonAffiliationOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增身分/歸屬紀錄",
)
async def create_affiliation(
    payload: PersonAffiliationCreate, db: DbDep, actor: PeopleManager
) -> PersonAffiliationOut:
    scope = await _get_people_access_scope(db, actor)
    await _require_person_scope(db, payload.person_id, scope)
    await _require_new_affiliation_scope(db, payload, scope)
    try:
        affiliation = await person_svc.create_affiliation(db, data=payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    refreshed = await person_svc.get_person(db, affiliation.person_id)
    affiliation = next(
        item for item in (refreshed.affiliations if refreshed else []) if item.id == affiliation.id
    )
    await audit_svc.record(
        db,
        entity_type="person_affiliation",
        entity_id=str(affiliation.id),
        action="person.affiliation_create",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=payload.model_dump(mode="json"),
        summary="新增人員身分/歸屬",
    )
    return person_svc.affiliation_to_out(affiliation)


@router.patch(
    "/affiliations/{affiliation_id}",
    response_model=PersonAffiliationOut,
    summary="更新身分/歸屬紀錄",
)
async def update_affiliation(
    affiliation_id: uuid.UUID,
    payload: PersonAffiliationUpdate,
    db: DbDep,
    actor: PeopleManager,
) -> PersonAffiliationOut:
    scope = await _get_people_access_scope(db, actor)
    affiliation = await _get_affiliation_or_404(db, affiliation_id)
    await _require_affiliation_scope(db, affiliation, scope)
    affiliation = await person_svc.update_affiliation(db, affiliation, data=payload)
    refreshed = await person_svc.get_person(db, affiliation.person_id)
    affiliation = next(
        item for item in (refreshed.affiliations if refreshed else []) if item.id == affiliation.id
    )
    await audit_svc.record(
        db,
        entity_type="person_affiliation",
        entity_id=str(affiliation.id),
        action="person.affiliation_update",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=payload.model_dump(mode="json", exclude_unset=True),
        summary="更新人員身分/歸屬",
    )
    return person_svc.affiliation_to_out(affiliation)


@router.delete(
    "/affiliations/{affiliation_id}",
    response_model=PersonAffiliationOut,
    summary="結束身分/歸屬紀錄",
)
async def end_affiliation(
    affiliation_id: uuid.UUID,
    db: DbDep,
    actor: PeopleManager,
) -> PersonAffiliationOut:
    scope = await _get_people_access_scope(db, actor)
    affiliation = await _get_affiliation_or_404(db, affiliation_id)
    await _require_affiliation_scope(db, affiliation, scope)
    affiliation = await person_svc.end_affiliation(db, affiliation)
    refreshed = await person_svc.get_person(db, affiliation.person_id)
    affiliation = next(
        item for item in (refreshed.affiliations if refreshed else []) if item.id == affiliation.id
    )
    await audit_svc.record(
        db,
        entity_type="person_affiliation",
        entity_id=str(affiliation.id),
        action="person.affiliation_end",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta={"end_date": affiliation.end_date.isoformat() if affiliation.end_date else None},
        summary="結束人員身分/歸屬",
    )
    return person_svc.affiliation_to_out(affiliation)


@router.post(
    "/{person_id}/sync-pending",
    summary="將已連結 User 的待生效身分同步到 RBAC",
)
async def sync_pending(person_id: uuid.UUID, db: DbDep, _: AdminUser) -> dict[str, int]:
    person = await _get_person_or_404(db, person_id)
    count = await person_svc.sync_pending_affiliations_for_person(db, person)
    return {"synced": count}
