"""以現有人員與帳號核對名單，不在查詢時建立或修改人員資料。"""

from sqlalchemy import and_, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.search import like_contains
from api.models.person import Person
from api.models.school_class import ClassRosterEntry, SchoolClass
from api.models.user import User
from api.schemas.shop_targets import ShopTargetOut


async def lookup_targets(
    session: AsyncSession, *, keyword: str, identifiers: list[str]
) -> list[ShopTargetOut]:
    identifiers = list(
        dict.fromkeys(value.strip().lower() for value in identifiers if value.strip())
    )
    keyword = keyword.strip()
    if not keyword and not identifiers:
        return []

    identity_join = or_(
        Person.user_id == User.id,
        and_(Person.user_id.is_(None), Person.student_id == User.student_id),
    )
    accounts = select(
        func.coalesce(Person.student_id, User.student_id).label("student_id"),
        func.coalesce(Person.legal_name, Person.display_name, User.display_name).label(
            "display_name"
        ),
        User.email.label("email"),
        User.is_active.label("account_active"),
    ).outerjoin(Person, identity_join)
    people = (
        select(
            Person.student_id,
            func.coalesce(Person.legal_name, Person.display_name).label("display_name"),
            Person.email,
            literal(None).label("account_active"),
        )
        .outerjoin(User, identity_join)
        .where(User.id.is_(None), Person.student_id.is_not(None))
    )
    candidates = union_all(accounts, people).subquery()
    query = select(candidates)
    if identifiers:
        query = query.where(
            or_(
                func.lower(candidates.c.student_id).in_(identifiers),
                func.lower(candidates.c.email).in_(identifiers),
            )
        )
    else:
        pattern = like_contains(keyword)
        query = query.where(
            or_(
                candidates.c.display_name.ilike(pattern, escape="\\"),
                candidates.c.student_id.ilike(pattern, escape="\\"),
                candidates.c.email.ilike(pattern, escape="\\"),
            )
        ).limit(50)
    rows = (
        await session.execute(query.order_by(candidates.c.student_id, candidates.c.email))
    ).all()
    options: dict[str, ShopTargetOut] = {}
    for row in rows:
        identifier = (row.student_id or row.email).lower()
        option = ShopTargetOut(
            identifier=identifier,
            student_id=row.student_id,
            display_name=row.display_name,
            email=row.email,
            matched=True,
            account_active=row.account_active,
        )
        options[identifier] = option
        if row.email:
            options[row.email.lower()] = option

    student_ids = {option.student_id for option in options.values() if option.student_id}
    student_ids.update(value for value in identifiers if "@" not in value)
    if student_ids:
        rosters = await session.execute(
            select(ClassRosterEntry, SchoolClass)
            .join(SchoolClass, ClassRosterEntry.class_id == SchoolClass.id)
            .where(SchoolClass.is_active.is_(True), ClassRosterEntry.student_id.in_(student_ids))
            .order_by(SchoolClass.academic_year.desc(), SchoolClass.class_code)
        )
        seen: set[str] = set()
        for entry, school_class in rosters:
            if entry.student_id in seen:
                continue
            seen.add(entry.student_id)
            option = options.get(entry.student_id)
            if option is None:
                option = ShopTargetOut(identifier=entry.student_id, student_id=entry.student_id)
                options[entry.student_id] = option
            option.matched = True
            option.class_label = school_class.label or f"{school_class.class_code} 班"
            option.seat_number = entry.seat_number

    if identifiers:
        return [
            options[value].model_copy(update={"identifier": value})
            if value in options
            else ShopTargetOut(identifier=value)
            for value in identifiers
        ]
    return list({option.identifier: option for option in options.values()}.values())
