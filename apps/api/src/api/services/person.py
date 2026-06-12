"""人員主檔與身分歸屬服務層。"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.cache import cache_invalidate
from api.services._base import apply_updates
from api.core.clock import local_today
from api.models.org import Position, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
    PersonStatus,
)
from api.models.school_class import (
    ClassRoleBinding,
    SchoolClass,
)
from api.models.user import User
from api.schemas.person import (
    PersonAffiliationCreate,
    PersonAffiliationOut,
    PersonAffiliationUpdate,
    PersonCreate,
    PersonDetailOut,
    PersonListItem,
    PersonRosterImport,
    PersonRosterImportResult,
    PersonUpdate,
)
from api.services.discord_bot import enqueue_role_sync


def _class_label(sc: SchoolClass | None) -> str | None:
    if sc is None:
        return None
    return sc.label or f"{sc.academic_year} 學年度 {sc.class_code} 班"


def affiliation_to_out(affiliation: PersonAffiliation) -> PersonAffiliationOut:
    return PersonAffiliationOut(
        id=affiliation.id,
        person_id=affiliation.person_id,
        kind=PersonAffiliationKind(affiliation.kind),
        academic_year=affiliation.academic_year,
        class_id=affiliation.class_id,
        class_label=_class_label(affiliation.school_class),
        org_id=affiliation.org_id,
        org_name=affiliation.org.name if affiliation.org else None,
        position_id=affiliation.position_id,
        position_name=affiliation.position.name if affiliation.position else None,
        role_key=affiliation.role_key,
        title=affiliation.title,
        start_date=affiliation.start_date,
        end_date=affiliation.end_date,
        status=PersonAffiliationStatus(affiliation.status),
        source=PersonAffiliationSource(affiliation.source),
        synced_user_position_id=affiliation.synced_user_position_id,
        note=affiliation.note,
        created_at=affiliation.created_at,
        updated_at=affiliation.updated_at,
    )


def person_to_detail(person: Person) -> PersonDetailOut:
    return PersonDetailOut(
        id=person.id,
        user_id=person.user_id,
        student_id=person.student_id,
        display_name=person.display_name,
        legal_name=person.legal_name,
        email=person.email,
        status=PersonStatus(person.status),
        note=person.note,
        created_at=person.created_at,
        updated_at=person.updated_at,
        affiliations=[affiliation_to_out(affiliation) for affiliation in person.affiliations],
    )


async def get_person(db: AsyncSession, person_id: uuid.UUID) -> Person | None:
    return await db.scalar(
        select(Person)
        .options(
            selectinload(Person.affiliations).selectinload(PersonAffiliation.school_class),
            selectinload(Person.affiliations).selectinload(PersonAffiliation.org),
            selectinload(Person.affiliations).selectinload(PersonAffiliation.position),
        )
        .where(Person.id == person_id)
    )


async def list_people(
    db: AsyncSession,
    *,
    keyword: str | None = None,
    class_id: uuid.UUID | None = None,
    org_id: uuid.UUID | None = None,
    position_id: uuid.UUID | None = None,
    status: PersonStatus | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[PersonListItem]:
    query = (
        select(Person)
        .options(
            selectinload(Person.affiliations).selectinload(PersonAffiliation.school_class),
            selectinload(Person.affiliations).selectinload(PersonAffiliation.org),
            selectinload(Person.affiliations).selectinload(PersonAffiliation.position),
        )
        .order_by(Person.student_id, Person.display_name)
        .limit(limit)
        .offset(offset)
    )
    if keyword:
        pattern = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                Person.display_name.ilike(pattern),
                Person.legal_name.ilike(pattern),
                Person.email.ilike(pattern),
                Person.student_id.ilike(pattern),
            )
        )
    if status is not None:
        query = query.where(Person.status == status)
    if class_id or org_id or position_id:
        query = query.join(PersonAffiliation)
        if class_id:
            query = query.where(PersonAffiliation.class_id == class_id)
        if org_id:
            query = query.where(PersonAffiliation.org_id == org_id)
        if position_id:
            query = query.where(PersonAffiliation.position_id == position_id)

    result = await db.execute(query)
    rows: list[PersonListItem] = []
    for person in result.scalars().unique().all():
        active = [
            affiliation
            for affiliation in person.affiliations
            if affiliation.status
            in {PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER}
        ]
        rows.append(
            PersonListItem(
                id=person.id,
                user_id=person.user_id,
                student_id=person.student_id,
                display_name=person.display_name,
                legal_name=person.legal_name,
                email=person.email,
                status=PersonStatus(person.status),
                note=person.note,
                created_at=person.created_at,
                updated_at=person.updated_at,
                active_affiliation_count=len(active),
                class_labels=sorted(
                    {
                        label
                        for affiliation in active
                        if (label := _class_label(affiliation.school_class)) is not None
                    }
                ),
                role_titles=sorted(
                    {
                        affiliation.title
                        or (affiliation.position.name if affiliation.position else None)
                        or affiliation.role_key
                        or affiliation.kind
                        for affiliation in active
                        if affiliation.kind
                        in {PersonAffiliationKind.CLASS_ROLE, PersonAffiliationKind.ORG_POSITION}
                    }
                ),
            )
        )
    return rows


async def create_person(db: AsyncSession, *, data: PersonCreate) -> Person:
    person = Person(**data.model_dump())
    db.add(person)
    await db.flush()
    return person


async def update_person(db: AsyncSession, person: Person, *, data: PersonUpdate) -> Person:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(person, field, value)
    await db.flush()
    if person.user_id is not None:
        await sync_pending_affiliations_for_person(db, person)
    return person


async def ensure_person_for_user(
    db: AsyncSession,
    user: User,
    *,
    source: PersonAffiliationSource = PersonAffiliationSource.MANUAL,
) -> Person:
    if user.student_id:
        person = await db.scalar(select(Person).where(Person.student_id == user.student_id))
        if person is not None:
            changed = False
            if person.user_id is None:
                person.user_id = user.id
                changed = True
            if not person.email:
                person.email = user.email
                changed = True
            if not person.display_name:
                person.display_name = user.display_name
                changed = True
            if changed:
                await db.flush()
                await sync_pending_affiliations_for_person(db, person)
            return person

    person = await db.scalar(select(Person).where(Person.user_id == user.id))
    if person is not None:
        return person

    person = Person(
        user_id=user.id,
        student_id=user.student_id,
        display_name=user.display_name,
        email=user.email,
        status=PersonStatus.ACTIVE,
        note=f"由 {source} 自動建立",
    )
    db.add(person)
    await db.flush()
    return person


async def _find_active_affiliation(
    db: AsyncSession,
    *,
    person_id: uuid.UUID,
    kind: PersonAffiliationKind,
    class_id: uuid.UUID | None,
    org_id: uuid.UUID | None,
    position_id: uuid.UUID | None,
    role_key: str | None,
) -> PersonAffiliation | None:
    return await db.scalar(
        select(PersonAffiliation).where(
            PersonAffiliation.person_id == person_id,
            PersonAffiliation.kind == kind,
            PersonAffiliation.class_id.is_(None)
            if class_id is None
            else PersonAffiliation.class_id == class_id,
            PersonAffiliation.org_id.is_(None)
            if org_id is None
            else PersonAffiliation.org_id == org_id,
            PersonAffiliation.position_id.is_(None)
            if position_id is None
            else PersonAffiliation.position_id == position_id,
            PersonAffiliation.role_key.is_(None)
            if role_key is None
            else PersonAffiliation.role_key == role_key,
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
        )
    )


async def create_affiliation(
    db: AsyncSession, *, data: PersonAffiliationCreate
) -> PersonAffiliation:
    person = await db.get(Person, data.person_id)
    if person is None:
        raise ValueError("找不到人員主檔")

    class_id = data.class_id
    org_id = data.org_id
    position_id = data.position_id
    academic_year = data.academic_year
    title = data.title

    if data.kind in {PersonAffiliationKind.CLASS_MEMBER, PersonAffiliationKind.CLASS_ROLE}:
        sc = await db.get(SchoolClass, class_id)
        if sc is None:
            raise ValueError("找不到班級")
        academic_year = academic_year or sc.academic_year
        org_id = org_id or sc.org_id
        if data.kind == PersonAffiliationKind.CLASS_ROLE and position_id is None and data.role_key:
            binding = await db.scalar(
                select(ClassRoleBinding).where(
                    ClassRoleBinding.class_id == class_id,
                    ClassRoleBinding.role_key == data.role_key,
                )
            )
            if binding is not None:
                position_id = binding.position_id
    if position_id is not None:
        position = await db.get(Position, position_id)
        if position is None:
            raise ValueError("找不到職位")
        org_id = org_id or position.org_id
        title = title or position.name

    existing = await _find_active_affiliation(
        db,
        person_id=person.id,
        kind=data.kind,
        class_id=class_id,
        org_id=org_id,
        position_id=position_id,
        role_key=data.role_key,
    )
    if existing is not None:
        return existing

    affiliation = PersonAffiliation(
        person_id=person.id,
        kind=data.kind,
        academic_year=academic_year,
        class_id=class_id,
        org_id=org_id,
        position_id=position_id,
        role_key=data.role_key,
        title=title,
        start_date=data.start_date or local_today(),
        end_date=data.end_date,
        status=PersonAffiliationStatus.ACTIVE
        if person.user_id is not None or position_id is None
        else PersonAffiliationStatus.PENDING_USER,
        source=data.source,
        note=data.note,
    )
    db.add(affiliation)
    await db.flush()
    await sync_affiliation_to_rbac(db, affiliation)
    return affiliation


async def update_affiliation(
    db: AsyncSession, affiliation: PersonAffiliation, *, data: PersonAffiliationUpdate
) -> PersonAffiliation:
    before_status = affiliation.status
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(affiliation, field, value)
    if affiliation.status == PersonAffiliationStatus.ENDED and affiliation.end_date is None:
        affiliation.end_date = local_today()
    if affiliation.end_date is not None and affiliation.status == PersonAffiliationStatus.ACTIVE:
        affiliation.status = PersonAffiliationStatus.ENDED
    await db.flush()
    await sync_affiliation_to_rbac(db, affiliation)
    if before_status != affiliation.status and affiliation.synced_user_position_id is not None:
        synced = await db.get(UserPosition, affiliation.synced_user_position_id)
        if synced is not None:
            await enqueue_role_sync(db, synced.user_id)
    return affiliation


async def end_affiliation(
    db: AsyncSession, affiliation: PersonAffiliation, *, end_date: date | None = None
) -> PersonAffiliation:
    affiliation.status = PersonAffiliationStatus.ENDED
    affiliation.end_date = end_date or local_today()
    await db.flush()
    await sync_affiliation_to_rbac(db, affiliation)
    return affiliation


async def sync_affiliation_to_rbac(
    db: AsyncSession, affiliation: PersonAffiliation
) -> UserPosition | None:
    if affiliation.kind not in {
        PersonAffiliationKind.CLASS_ROLE,
        PersonAffiliationKind.ORG_POSITION,
    }:
        return None
    if affiliation.position_id is None:
        return None
    person = affiliation.person or await db.get(Person, affiliation.person_id)
    if person is None or person.user_id is None:
        affiliation.status = PersonAffiliationStatus.PENDING_USER
        await db.flush()
        return None

    if affiliation.synced_user_position_id is not None:
        up = await db.get(UserPosition, affiliation.synced_user_position_id)
        if up is not None:
            up.start_date = affiliation.start_date
            up.end_date = affiliation.end_date
            await db.flush()
            await cache_invalidate(f"perm:{up.user_id}")
            await enqueue_role_sync(db, up.user_id)
            return up

    up = await db.scalar(
        select(UserPosition).where(
            UserPosition.user_id == person.user_id,
            UserPosition.position_id == affiliation.position_id,
            UserPosition.start_date == affiliation.start_date,
            UserPosition.end_date.is_(None)
            if affiliation.end_date is None
            else UserPosition.end_date == affiliation.end_date,
        )
    )
    if up is None:
        up = UserPosition(
            user_id=person.user_id,
            position_id=affiliation.position_id,
            start_date=affiliation.start_date,
            end_date=affiliation.end_date,
        )
        db.add(up)
        await db.flush()
    affiliation.synced_user_position_id = up.id
    if affiliation.status == PersonAffiliationStatus.PENDING_USER:
        affiliation.status = PersonAffiliationStatus.ACTIVE
    await db.flush()
    await cache_invalidate(f"perm:{person.user_id}")
    await enqueue_role_sync(db, person.user_id)
    return up


async def sync_pending_affiliations_for_person(db: AsyncSession, person: Person) -> int:
    result = await db.execute(
        select(PersonAffiliation).where(
            PersonAffiliation.person_id == person.id,
            PersonAffiliation.status == PersonAffiliationStatus.PENDING_USER,
        )
    )
    count = 0
    for affiliation in result.scalars().all():
        synced = await sync_affiliation_to_rbac(db, affiliation)
        if synced is not None:
            count += 1
    return count


async def record_affiliation_for_user_position(
    db: AsyncSession,
    *,
    user: User,
    kind: PersonAffiliationKind,
    position_id: uuid.UUID | None,
    start_date: date,
    end_date: date | None,
    class_id: uuid.UUID | None = None,
    role_key: str | None = None,
    synced_user_position_id: uuid.UUID | None = None,
    source: PersonAffiliationSource = PersonAffiliationSource.RBAC_SYNC,
) -> PersonAffiliation:
    person = await ensure_person_for_user(db, user, source=source)
    org_id = None
    title = None
    if position_id is not None:
        position = await db.get(Position, position_id)
        if position is not None:
            org_id = position.org_id
            title = position.name
    existing = await _find_active_affiliation(
        db,
        person_id=person.id,
        kind=kind,
        class_id=class_id,
        org_id=org_id,
        position_id=position_id,
        role_key=role_key,
    )
    if existing is not None:
        if synced_user_position_id is not None and existing.synced_user_position_id is None:
            existing.synced_user_position_id = synced_user_position_id
            await db.flush()
        return existing
    affiliation = PersonAffiliation(
        person_id=person.id,
        kind=kind,
        class_id=class_id,
        org_id=org_id,
        position_id=position_id,
        role_key=role_key,
        title=title,
        start_date=start_date,
        end_date=end_date,
        status=PersonAffiliationStatus.ACTIVE,
        source=source,
        synced_user_position_id=synced_user_position_id,
    )
    db.add(affiliation)
    await db.flush()
    return affiliation


async def import_roster(db: AsyncSession, *, data: PersonRosterImport) -> PersonRosterImportResult:
    created = 0
    updated = 0
    affiliations_created = 0
    skipped = 0
    for row in data.rows:
        person = await db.scalar(select(Person).where(Person.student_id == row.student_id))
        if person is None:
            person = Person(
                student_id=row.student_id,
                display_name=row.display_name,
                email=row.email,
                status=PersonStatus.ACTIVE,
                note=row.note,
            )
            db.add(person)
            await db.flush()
            created += 1
        else:
            person.display_name = row.display_name
            person.email = row.email or person.email
            person.note = row.note if row.note is not None else person.note
            updated += 1

        if row.class_id is None:
            skipped += 1
            continue
        before = await _find_active_affiliation(
            db,
            person_id=person.id,
            kind=PersonAffiliationKind.CLASS_MEMBER,
            class_id=row.class_id,
            org_id=None,
            position_id=None,
            role_key=None,
        )
        if before is not None:
            skipped += 1
            continue
        await create_affiliation(
            db,
            data=PersonAffiliationCreate(
                person_id=person.id,
                kind=PersonAffiliationKind.CLASS_MEMBER,
                class_id=row.class_id,
                academic_year=row.academic_year,
                source=PersonAffiliationSource.IMPORT,
            ),
        )
        affiliations_created += 1
    await db.flush()
    return PersonRosterImportResult(
        total=len(data.rows),
        people_created=created,
        people_updated=updated,
        affiliations_created=affiliations_created,
        skipped=skipped,
    )
