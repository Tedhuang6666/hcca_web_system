"""人員目錄統計查詢。"""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationStatus,
    PersonStatus,
)
from api.models.user import User
from api.schemas.person import PersonDirectoryStats
from api.services.person_access import scope_affiliation_filters, scoped_person_ids_query


async def get_directory_stats(
    db: AsyncSession,
    *,
    keyword: str | None = None,
    class_id: uuid.UUID | None = None,
    status: PersonStatus | None = None,
    scope_org_ids: set[uuid.UUID] | None = None,
    scope_class_ids: set[uuid.UUID] | None = None,
) -> PersonDirectoryStats:
    scoped_person_ids = scoped_person_ids_query(
        org_ids=scope_org_ids,
        class_ids=scope_class_ids,
    )
    scoped = scope_org_ids is not None or scope_class_ids is not None
    if scoped:
        account_count = (
            await db.scalar(
                select(func.count(func.distinct(Person.user_id))).where(
                    Person.user_id.is_not(None), Person.id.in_(scoped_person_ids)
                )
            )
            or 0
        )
        people_count = (
            await db.scalar(select(func.count(Person.id)).where(Person.id.in_(scoped_person_ids)))
            or 0
        )
    else:
        account_count = await db.scalar(select(func.count(User.id))) or 0
        people_count = await db.scalar(select(func.count(Person.id))) or 0
    linked_count = (
        await db.scalar(
            select(func.count(Person.id)).where(
                Person.user_id.is_not(None),
                *([Person.id.in_(scoped_person_ids)] if scoped else []),
            )
        )
        or 0
    )
    classed_count = (
        await db.scalar(
            select(func.count(func.distinct(PersonAffiliation.person_id))).where(
                PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
                PersonAffiliation.status.in_(
                    [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
                ),
                *scope_affiliation_filters(
                    org_ids=scope_org_ids,
                    class_ids=scope_class_ids,
                ),
            )
        )
        or 0
    )
    pending_link_count = (
        await db.scalar(
            select(func.count(func.distinct(PersonAffiliation.person_id))).where(
                PersonAffiliation.status == PersonAffiliationStatus.PENDING_USER,
                *scope_affiliation_filters(
                    org_ids=scope_org_ids,
                    class_ids=scope_class_ids,
                ),
            )
        )
        or 0
    )

    matched_query = select(func.count(func.distinct(Person.id))).select_from(Person)
    if scoped:
        matched_query = matched_query.where(Person.id.in_(scoped_person_ids))
    if keyword:
        pattern = f"%{keyword.strip()}%"
        matched_query = matched_query.where(
            or_(
                Person.display_name.ilike(pattern),
                Person.legal_name.ilike(pattern),
                Person.email.ilike(pattern),
                Person.student_id.ilike(pattern),
            )
        )
    if status is not None:
        matched_query = matched_query.where(Person.status == status)
    if class_id:
        matched_query = matched_query.join(PersonAffiliation).where(
            PersonAffiliation.class_id == class_id,
            *(
                scope_affiliation_filters(
                    org_ids=scope_org_ids,
                    class_ids=scope_class_ids,
                )
                if scoped
                else []
            ),
        )
    matched_people_count = await db.scalar(matched_query) or 0

    return PersonDirectoryStats(
        account_count=account_count,
        people_count=people_count,
        linked_count=linked_count,
        classed_count=classed_count,
        pending_link_count=pending_link_count,
        matched_people_count=matched_people_count,
    )
