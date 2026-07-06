"""人員主檔與身分歸屬 Router。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any, require_permission
from api.models.person import Person, PersonAffiliation, PersonStatus
from api.models.user import User
from api.routers._common import or_404
from api.schemas.person import (
    PersonAffiliationCreate,
    PersonAffiliationOut,
    PersonAffiliationUpdate,
    PersonCreate,
    PersonDetailOut,
    PersonListItem,
    PersonOut,
    PersonRosterImport,
    PersonRosterImportResult,
    PersonUpdate,
)
from api.services import audit as audit_svc
from api.services import person as person_svc

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


async def _get_person_or_404(db: AsyncSession, person_id: uuid.UUID) -> Person:
    person = await person_svc.get_person(db, person_id)
    return or_404(person, "找不到人員主檔")


async def _get_affiliation_or_404(db: AsyncSession, affiliation_id: uuid.UUID) -> PersonAffiliation:
    affiliation = await db.get(PersonAffiliation, affiliation_id)
    return or_404(affiliation, "找不到身分紀錄")


@router.get("", response_model=list[PersonListItem], summary="搜尋人員主檔")
async def list_people(
    db: DbDep,
    _: PeopleManager,
    keyword: str | None = Query(None, description="姓名、學號、Email"),
    class_id: uuid.UUID | None = Query(None, description="班級 ID"),
    org_id: uuid.UUID | None = Query(None, description="組織 ID"),
    position_id: uuid.UUID | None = Query(None, description="職位 ID"),
    status_filter: PersonStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[PersonListItem]:
    return await person_svc.list_people(
        db,
        keyword=keyword,
        class_id=class_id,
        org_id=org_id,
        position_id=position_id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    response_model=PersonOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立人員主檔",
)
async def create_person(payload: PersonCreate, db: DbDep, actor: PeopleManager) -> Person:
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
    result = await person_svc.import_roster(db, data=payload)
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
async def get_person(person_id: uuid.UUID, db: DbDep, _: PeopleManager) -> PersonDetailOut:
    person = await _get_person_or_404(db, person_id)
    return person_svc.person_to_detail(person)


@router.patch("/{person_id}", response_model=PersonOut, summary="更新人員主檔")
async def update_person(
    person_id: uuid.UUID,
    payload: PersonUpdate,
    db: DbDep,
    actor: PeopleManager,
) -> Person:
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
    affiliation = await _get_affiliation_or_404(db, affiliation_id)
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
    affiliation = await _get_affiliation_or_404(db, affiliation_id)
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
