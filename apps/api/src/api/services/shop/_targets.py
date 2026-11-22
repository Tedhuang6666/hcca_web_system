"""以現有人員與帳號核對名單，不在查詢時建立或修改人員資料。"""

from uuid import UUID

from sqlalchemy import and_, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.search import like_contains
from api.models.person import Person
from api.models.school_class import ClassRosterEntry, SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus
from api.models.user import User
from api.schemas.shop_targets import ShopTargetOut
from api.services.student_identity_rules import SCHOOL_EMAIL_DOMAIN, student_id_from_school_email


async def lookup_targets(
    session: AsyncSession, *, keyword: str, identifiers: list[str], product_id: UUID | None = None
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
        result = [
            options[value].model_copy(update={"identifier": value})
            if value in options
            else ShopTargetOut(identifier=value)
            for value in identifiers
        ]
    else:
        result = list({option.identifier: option for option in options.values()}.values())
    if product_id is not None and result:
        await _attach_order_status(session, result, product_id)
    return result


async def _attach_order_status(
    session: AsyncSession, targets: list[ShopTargetOut], product_id: UUID
) -> None:
    identifiers = {
        identifier.lower()
        for target in targets
        for identifier in (target.identifier, target.student_id, target.email)
        if identifier
    }
    # 學校帳號尚未綁人員檔時，也能以學號找到已成立的本人／代訂訂單。
    school_emails = {
        f"g0{identifier}@{SCHOOL_EMAIL_DOMAIN}"
        for identifier in identifiers
        if "@" not in identifier
    }
    rows = await session.execute(
        select(User.email, User.student_id, Person.student_id)
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .join(User, User.id == Order.user_id)
        .outerjoin(Person, Person.user_id == User.id)
        .where(
            OrderItem.product_id == product_id,
            OrderItem.quantity > 0,
            Order.status.in_([OrderStatus.PENDING, OrderStatus.CONFIRMED]),
            Order.test_product_id.is_(None),
            or_(
                func.lower(User.email).in_(identifiers | school_emails),
                User.student_id.in_(identifiers),
                Person.student_id.in_(identifiers),
            ),
        )
        .distinct()
    )
    ordered = {
        identifier.lower()
        for email, user_student_id, person_student_id in rows
        for identifier in (
            email,
            user_student_id,
            person_student_id,
            student_id_from_school_email(email),
        )
        if identifier
    }
    for target in targets:
        target.has_ordered = any(
            identifier.lower() in ordered
            for identifier in (target.identifier, target.student_id, target.email)
            if identifier
        )
