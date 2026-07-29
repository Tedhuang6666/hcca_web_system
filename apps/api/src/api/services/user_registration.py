"""管理員預先建立使用者的業務邏輯。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.schema import UniqueConstraint

from api.core.cache import cache_invalidate_user_permissions
from api.core.database import Base
from api.core.permission_codes import validate_permission_codes
from api.models.org import Org, Permission, Position, PositionCategory, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
)
from api.models.school_class import (
    ClassCadre,
    ClassManualMember,
    ClassMembership,
    ClassRosterEntry,
)
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services import audit as audit_svc
from api.services import person as person_svc
from api.services.discord_bot import enqueue_role_sync

SCHOOL_EMAIL_DOMAIN = "hchs.hc.edu.tw"


class UserRegistrationError(Exception):
    def __init__(
        self,
        status_code: int,
        detail: str,
        *,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.payload = payload


_ACCOUNT_MERGE_EXCLUDED_TABLES = frozenset(
    {
        "people",
        "user_identities",
        "class_cadres",
        "class_manual_members",
        "class_memberships",
        "class_roster_entries",
    }
)
_ACCOUNT_MERGE_SAFE_DUPLICATE_TABLES = frozenset(
    {
        "activity_members",
        "announcement_audience_users",
        "calendar_event_participants",
        "email_recipient_list_members",
        "meal_vendor_managers",
        "meeting_agenda_recusals",
    }
)


def _serialize_merge_value(value: Any) -> str:
    if value is None:
        return "空白"
    return str(value)


def _merge_record_id(table_name: str, primary_key_columns, row) -> str:
    return ":".join(
        [
            table_name,
            *(
                f"{column.name}={_serialize_merge_value(_row_value(row, column))}"
                for column in primary_key_columns
            ),
        ]
    )


def _public_merge_conflict(conflict: dict[str, Any]) -> dict[str, Any]:
    public = {key: value for key, value in conflict.items() if not key.startswith("_")}
    public["records"] = [
        {key: value for key, value in record.items() if not key.startswith("_")}
        for record in conflict["records"]
    ]
    return public


def _user_fk_columns(table):
    return [
        column
        for column in table.columns
        if any(foreign_key.target_fullname == "users.id" for foreign_key in column.foreign_keys)
    ]


def _unique_column_sets(table):
    unique_sets = []
    for constraint in table.constraints:
        if isinstance(constraint, UniqueConstraint):
            unique_sets.append(tuple(constraint.columns))
    for index in table.indexes:
        if index.unique:
            unique_sets.append(tuple(index.columns))
    return unique_sets


def _row_value(row, column):
    return row._mapping[column]


def _row_key(row, columns):
    return tuple(_row_value(row, column) for column in columns)


def _merge_record_descriptor(
    table,
    row,
    user_columns,
    *,
    target_user_id: uuid.UUID,
    user_names: dict[uuid.UUID, str],
    fields: Iterable,
) -> dict[str, Any]:
    primary_key_columns = tuple(table.primary_key.columns)
    user_ids = [
        _row_value(row, column) for column in user_columns if _row_value(row, column) is not None
    ]
    owner_user_id = next(
        (user_id for user_id in user_ids if user_id != target_user_id),
        target_user_id,
    )
    side = "target" if owner_user_id == target_user_id else "source"
    record_id = _merge_record_id(table.name, primary_key_columns, row)
    field_values = {
        column.name: _serialize_merge_value(_row_value(row, column)) for column in fields
    }
    return {
        "id": record_id,
        "side": side,
        "owner_user_id": str(owner_user_id),
        "owner_name": user_names.get(owner_user_id, "帳戶"),
        "label": "、".join(f"{name}={value}" for name, value in field_values.items()),
        "fields": field_values,
        "_table": table,
        "_primary_key": _row_key(row, primary_key_columns),
    }


async def _collect_table_merge_conflicts(
    db: AsyncSession,
    table,
    *,
    target_user_id: uuid.UUID,
    user_ids: set[uuid.UUID],
    user_names: dict[uuid.UUID, str],
    require_user_column: bool = True,
) -> list[dict[str, Any]]:
    user_columns = _user_fk_columns(table)
    if not user_columns:
        return []
    rows = (
        await db.execute(
            select(table).where(or_(*(column.in_(user_ids) for column in user_columns)))
        )
    ).all()
    if not rows:
        return []

    user_column_names = {column.name for column in user_columns}
    conflicts: list[dict[str, Any]] = []
    for unique_columns in _unique_column_sets(table):
        if require_user_column and not {column.name for column in unique_columns}.intersection(
            user_column_names
        ):
            continue
        groups: dict[tuple[Any, ...], list[Any]] = {}
        for row in rows:
            projected_values = tuple(
                target_user_id
                if column.name in user_column_names and _row_value(row, column) in user_ids
                else _row_value(row, column)
                for column in unique_columns
            )
            if any(value is None for value in projected_values):
                continue
            groups.setdefault(projected_values, []).append(row)

        for grouped_rows in groups.values():
            if len(grouped_rows) < 2 or table.name in _ACCOUNT_MERGE_SAFE_DUPLICATE_TABLES:
                continue
            descriptors = [
                _merge_record_descriptor(
                    table,
                    row,
                    user_columns,
                    target_user_id=target_user_id,
                    user_names=user_names,
                    fields=unique_columns,
                )
                for row in grouped_rows
            ]
            descriptors.sort(key=lambda item: item["id"])
            constraint_name = ",".join(column.name for column in unique_columns)
            record_ids = "|".join(item["id"] for item in descriptors)
            conflicts.append(
                {
                    "key": f"records:{table.name}:{constraint_name}:{record_ids}",
                    "category": "record",
                    "title": f"{table.name} 的重複資料",
                    "message": f"唯一欄位：{constraint_name}",
                    "records": descriptors,
                }
            )
    return conflicts


def _field_record(
    *,
    record_id: str,
    side: str,
    owner_user_id: uuid.UUID,
    owner_name: str,
    field: str,
    value: Any,
) -> dict[str, Any]:
    serialized = _serialize_merge_value(value)
    return {
        "id": record_id,
        "side": side,
        "owner_user_id": str(owner_user_id),
        "owner_name": owner_name,
        "label": f"{field}：{serialized}",
        "fields": {field: serialized},
        "_value": value,
    }


def _field_conflict(
    *,
    key: str,
    title: str,
    field: str,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "key": key,
        "category": "field",
        "title": title,
        "message": f"欄位：{field}，請選擇要保留的值",
        "records": records,
    }


async def _collect_identity_conflicts(
    db: AsyncSession,
    *,
    target_user: User,
    source_users: list[User],
) -> list[dict[str, Any]]:
    users = [target_user, *source_users]
    user_names = {item.id: item.display_name for item in users}
    records: list[dict[str, Any]] = []
    for item in users:
        if item.student_id:
            records.append(
                _field_record(
                    record_id=f"user:{item.id}:student_id",
                    side="target" if item.id == target_user.id else "source",
                    owner_user_id=item.id,
                    owner_name=user_names[item.id],
                    field="學號",
                    value=item.student_id,
                )
            )

    people = (
        await db.scalars(select(Person).where(Person.user_id.in_([item.id for item in users])))
    ).all()
    for person in people:
        if person.student_id and not any(
            item.id == person.user_id and item.student_id == person.student_id for item in users
        ):
            records.append(
                _field_record(
                    record_id=f"person:{person.id}:student_id",
                    side="target" if person.user_id == target_user.id else "source",
                    owner_user_id=person.user_id or target_user.id,
                    owner_name=user_names.get(person.user_id, "人員檔案"),
                    field="學號",
                    value=person.student_id,
                )
            )
    values = {record["_value"] for record in records}
    if len(values) < 2:
        return []
    records.sort(key=lambda item: item["id"])
    return [
        _field_conflict(
            key="field:identity:student_id:" + "|".join(item["id"] for item in records),
            title="學號身分衝突",
            field="student_id",
            records=records,
        )
    ]


async def _collect_profile_conflicts(
    db: AsyncSession,
    *,
    target_user: User,
    source_users: list[User],
) -> list[dict[str, Any]]:
    users = [target_user, *source_users]
    user_names = {item.id: item.display_name for item in users}
    conflicts: list[dict[str, Any]] = []
    for field, label in (("display_name", "顯示名稱"),):
        values = {item.display_name for item in users if getattr(item, field)}
        if len(values) > 1:
            records = [
                _field_record(
                    record_id=f"user:{item.id}:{field}",
                    side="target" if item.id == target_user.id else "source",
                    owner_user_id=item.id,
                    owner_name=item.display_name,
                    field=label,
                    value=getattr(item, field),
                )
                for item in users
            ]
            records.sort(key=lambda item: item["id"])
            conflicts.append(
                _field_conflict(
                    key=f"field:user:{field}:" + "|".join(item["id"] for item in records),
                    title=f"{label}衝突",
                    field=field,
                    records=records,
                )
            )

    people = (
        await db.scalars(select(Person).where(Person.user_id.in_([item.id for item in users])))
    ).all()
    for field, label in (
        ("legal_name", "法定姓名"),
        ("display_name", "人員顯示名稱"),
        ("email", "人員 Email"),
        ("note", "人員備註"),
        ("status", "人員狀態"),
    ):
        values = {getattr(person, field) for person in people if getattr(person, field)}
        if len(values) < 2:
            continue
        records = [
            _field_record(
                record_id=f"person:{person.id}:{field}",
                side="target" if person.user_id == target_user.id else "source",
                owner_user_id=person.user_id or target_user.id,
                owner_name=user_names.get(person.user_id, "人員檔案"),
                field=label,
                value=getattr(person, field),
            )
            for person in people
            if getattr(person, field)
        ]
        records.sort(key=lambda item: item["id"])
        conflicts.append(
            _field_conflict(
                key=f"field:person:{field}:" + "|".join(item["id"] for item in records),
                title=f"{label}衝突",
                field=field,
                records=records,
            )
        )
    return conflicts


async def _collect_class_merge_conflicts(
    db: AsyncSession,
    *,
    target_user: User,
    source_users: list[User],
) -> list[dict[str, Any]]:
    users = [target_user, *source_users]
    user_ids = {item.id for item in users}
    user_names = {item.id: item.display_name for item in users}
    conflicts: list[dict[str, Any]] = []
    for model in (ClassCadre, ClassManualMember, ClassRosterEntry):
        conflicts.extend(
            await _collect_table_merge_conflicts(
                db,
                model.__table__,
                target_user_id=target_user.id,
                user_ids=user_ids,
                user_names=user_names,
                require_user_column=model is not ClassRosterEntry,
            )
        )

    membership_rows = (
        await db.scalars(select(ClassMembership).where(ClassMembership.user_id.in_(user_ids)))
    ).all()
    grouped: dict[tuple[Any, ...], list[ClassMembership]] = {}
    for row in membership_rows:
        key = (row.class_id, row.academic_year, row.status, row.start_date, row.end_date)
        grouped.setdefault(key, []).append(row)
    for rows in grouped.values():
        if len(rows) < 2:
            continue
        descriptors = [
            {
                "id": f"class_memberships:id={row.id}",
                "side": "target" if row.user_id == target_user.id else "source",
                "owner_user_id": str(row.user_id),
                "owner_name": user_names.get(row.user_id, "帳戶"),
                "label": f"class_id={row.class_id}、academic_year={row.academic_year}、status={row.status}",
                "fields": {
                    "class_id": str(row.class_id),
                    "academic_year": str(row.academic_year),
                    "status": str(row.status),
                },
                "_table": ClassMembership.__table__,
                "_primary_key": (row.id,),
            }
            for row in rows
        ]
        descriptors.sort(key=lambda item: item["id"])
        conflicts.append(
            {
                "key": "records:class_memberships:logical:"
                + "|".join(item["id"] for item in descriptors),
                "category": "record",
                "title": "班級歷史紀錄重複",
                "message": "同一班級、學年度與狀態已有多筆資料",
                "records": descriptors,
            }
        )
    return conflicts


async def collect_merge_conflicts(
    db: AsyncSession,
    *,
    target_user: User,
    source_users: Iterable[User],
) -> list[dict[str, Any]]:
    """建立帳戶合併預覽；不會寫入資料庫。"""
    sources = list(source_users)
    users = [target_user, *sources]
    user_ids = {item.id for item in users}
    user_names = {item.id: item.display_name for item in users}
    conflicts = [
        *await _collect_identity_conflicts(
            db,
            target_user=target_user,
            source_users=sources,
        ),
        *await _collect_profile_conflicts(
            db,
            target_user=target_user,
            source_users=sources,
        ),
        *await _collect_class_merge_conflicts(
            db,
            target_user=target_user,
            source_users=sources,
        ),
    ]
    for table in Base.metadata.sorted_tables:
        if table.name in _ACCOUNT_MERGE_EXCLUDED_TABLES or table.name == "users":
            continue
        conflicts.extend(
            await _collect_table_merge_conflicts(
                db,
                table,
                target_user_id=target_user.id,
                user_ids=user_ids,
                user_names=user_names,
            )
        )
    conflicts.sort(key=lambda item: item["key"])
    return conflicts


async def _apply_record_conflict_resolutions(
    db: AsyncSession,
    *,
    conflicts: list[dict[str, Any]],
    resolutions: dict[str, str],
) -> None:
    for conflict in conflicts:
        if conflict["category"] != "record":
            continue
        selected_id = resolutions[conflict["key"]]
        selected = next(
            (record for record in conflict["records"] if record["id"] == selected_id),
            None,
        )
        if selected is None:
            raise UserRegistrationError(422, f"衝突選擇無效：{conflict['title']}")
        table = selected["_table"]
        primary_key_columns = tuple(table.primary_key.columns)
        for record in conflict["records"]:
            if record["id"] == selected_id:
                continue
            await db.execute(
                delete(table).where(
                    and_(
                        *(
                            column == value
                            for column, value in zip(
                                primary_key_columns,
                                record["_primary_key"],
                                strict=True,
                            )
                        )
                    )
                )
            )


async def _apply_field_conflict_resolutions(
    db: AsyncSession,
    *,
    target_user: User,
    source_users: list[User],
    conflicts: list[dict[str, Any]],
    resolutions: dict[str, str],
) -> None:
    users = [target_user, *source_users]
    people = (
        await db.scalars(select(Person).where(Person.user_id.in_([item.id for item in users])))
    ).all()
    people_by_user = {person.user_id: person for person in people if person.user_id}
    identity_value: Any = None
    for conflict in conflicts:
        if conflict["category"] != "field":
            continue
        selected_id = resolutions[conflict["key"]]
        selected = next(
            (record for record in conflict["records"] if record["id"] == selected_id),
            None,
        )
        if selected is None:
            raise UserRegistrationError(422, f"衝突選擇無效：{conflict['title']}")
        if conflict["key"].startswith("field:identity:student_id"):
            identity_value = selected["_value"]
        elif conflict["key"].startswith("field:user:"):
            owner = next(
                (item for item in users if str(item.id) == selected["owner_user_id"]), None
            )
            if owner is not None:
                setattr(
                    target_user,
                    conflict["message"].split("，", 1)[0].removeprefix("欄位："),
                    selected["_value"],
                )
        elif conflict["key"].startswith("field:person:"):
            target_field = conflict["key"].split(":", 3)[2]
            for person in people:
                setattr(person, target_field, selected["_value"])

    identity_conflict = next(
        (
            conflict
            for conflict in conflicts
            if conflict["key"].startswith("field:identity:student_id")
        ),
        None,
    )
    if identity_conflict is not None:
        for item in source_users:
            if item.student_id != identity_value:
                item.student_id = None
        target_user.student_id = identity_value
        target_person = people_by_user.get(target_user.id)
        if target_person is not None:
            target_person.student_id = identity_value
        for person in people:
            if person.user_id != target_user.id and person.student_id != identity_value:
                person.student_id = None
    await db.flush()


async def _preflight_user_record_reparenting(
    db: AsyncSession,
    *,
    target_user_id: uuid.UUID,
    source_user_id: uuid.UUID,
) -> None:
    """確認所有 User 外鍵都能安全轉移，避免合併途中才遇到唯一鍵衝突。"""
    for table in Base.metadata.sorted_tables:
        if table.name in _ACCOUNT_MERGE_EXCLUDED_TABLES or table.name == "users":
            continue
        user_columns = _user_fk_columns(table)
        if not user_columns:
            continue

        source_rows = (
            await db.execute(
                select(table).where(or_(*(column == source_user_id for column in user_columns)))
            )
        ).all()
        if not source_rows:
            continue

        primary_key_columns = tuple(table.primary_key.columns)
        user_column_names = {column.name for column in user_columns}
        for unique_columns in _unique_column_sets(table):
            if not {column.name for column in unique_columns}.intersection(user_column_names):
                continue
            for source_row in source_rows:
                unique_values = [
                    target_user_id
                    if column.name in user_column_names
                    else _row_value(source_row, column)
                    for column in unique_columns
                ]
                if any(value is None for value in unique_values):
                    continue
                target_row = (
                    await db.execute(
                        select(*primary_key_columns).where(
                            and_(
                                *(
                                    column == value
                                    for column, value in zip(
                                        unique_columns, unique_values, strict=True
                                    )
                                )
                            )
                        )
                    )
                ).first()
                if target_row is None or tuple(target_row) == _row_key(
                    source_row, primary_key_columns
                ):
                    continue
                if table.name not in _ACCOUNT_MERGE_SAFE_DUPLICATE_TABLES:
                    raise UserRegistrationError(
                        409,
                        f"兩個帳戶在 {table.name} 有無法自動合併的重複歷史資料，請先處理後再合併",
                    )


async def _reparent_user_records(
    db: AsyncSession,
    *,
    target_user_id: uuid.UUID,
    source_user_id: uuid.UUID,
) -> None:
    """將所有 ORM metadata 中指向 users.id 的歷史關聯轉到主要帳戶。"""
    for table in Base.metadata.sorted_tables:
        if table.name in _ACCOUNT_MERGE_EXCLUDED_TABLES or table.name == "users":
            continue
        user_columns = _user_fk_columns(table)
        if not user_columns:
            continue

        source_rows = (
            await db.execute(
                select(table).where(or_(*(column == source_user_id for column in user_columns)))
            )
        ).all()
        if not source_rows:
            continue

        user_column_names = {column.name for column in user_columns}
        duplicate_keys = set()
        for unique_columns in _unique_column_sets(table):
            if not {column.name for column in unique_columns}.intersection(user_column_names):
                continue
            for source_row in source_rows:
                unique_values = [
                    target_user_id
                    if column.name in user_column_names
                    else _row_value(source_row, column)
                    for column in unique_columns
                ]
                if any(value is None for value in unique_values):
                    continue
                target_row = (
                    await db.execute(
                        select(*table.primary_key.columns).where(
                            and_(
                                *(
                                    column == value
                                    for column, value in zip(
                                        unique_columns, unique_values, strict=True
                                    )
                                )
                            )
                        )
                    )
                ).first()
                if target_row is not None and tuple(target_row) != _row_key(
                    source_row, table.primary_key.columns
                ):
                    duplicate_keys.add(_row_key(source_row, table.primary_key.columns))

        if duplicate_keys:
            delete_conditions = [
                and_(
                    *(
                        column == value
                        for column, value in zip(
                            table.primary_key.columns, primary_key, strict=True
                        )
                    )
                )
                for primary_key in duplicate_keys
            ]
            await db.execute(delete(table).where(or_(*delete_conditions)))

        await db.execute(
            update(table)
            .where(or_(*(column == source_user_id for column in user_columns)))
            .values({column: target_user_id for column in user_columns})
        )


def _person_affiliation_key(affiliation: PersonAffiliation) -> tuple:
    return (
        affiliation.kind,
        affiliation.academic_year,
        affiliation.class_id,
        affiliation.org_id,
        affiliation.position_id,
        affiliation.role_key,
        affiliation.title,
        affiliation.start_date,
        affiliation.end_date,
        affiliation.status,
        affiliation.source,
        affiliation.note,
    )


async def _merge_person_profiles(
    db: AsyncSession,
    *,
    target_user: User,
    source_user: User,
) -> None:
    """把兩個 User 對應的人員主檔合併成一筆，保留所有身分歸屬紀錄。"""
    target_person = await db.scalar(
        select(Person)
        .options(selectinload(Person.affiliations))
        .where(Person.user_id == target_user.id)
    )
    source_person = await db.scalar(
        select(Person)
        .options(selectinload(Person.affiliations))
        .where(Person.user_id == source_user.id)
    )
    profile_student_ids = {
        student_id
        for student_id in (
            target_user.student_id,
            source_user.student_id,
            target_person.student_id if target_person else None,
            source_person.student_id if source_person else None,
        )
        if student_id
    }
    if len(profile_student_ids) > 1:
        raise UserRegistrationError(422, "要合併的人員檔案學號不一致")
    merged_student_id = next(iter(profile_student_ids), None)
    if merged_student_id and target_user.student_id is None:
        target_user.student_id = merged_student_id
    if target_person is None and target_user.student_id:
        target_person = await db.scalar(
            select(Person)
            .options(selectinload(Person.affiliations))
            .where(Person.student_id == target_user.student_id)
        )
        if target_person is not None:
            if target_person.user_id not in (None, target_user.id):
                raise UserRegistrationError(409, "學號已連結其他人員主檔")
            target_person.user_id = target_user.id

    if target_person is None and source_person is not None:
        source_person.user_id = target_user.id
        target_person = source_person
        source_person = None

    if target_person is None:
        return

    if (
        source_person is not None
        and source_person is not target_person
        and source_person.student_id == target_user.student_id
    ):
        # people.student_id 也是唯一欄位，先釋放次要檔案的值再套用到主要檔案。
        source_person.student_id = None
        await db.flush()

    target_person.student_id = merged_student_id
    target_person.email = target_person.email or target_user.email
    target_person.display_name = target_person.display_name or target_user.display_name
    if target_person.status == "inactive" and source_user.is_active:
        target_person.status = "active"

    if source_person is None or source_person is target_person:
        await db.flush()
        await person_svc.sync_pending_affiliations_for_person(db, target_person)
        return

    target_keys = {_person_affiliation_key(item) for item in target_person.affiliations}
    for affiliation in source_person.affiliations:
        if _person_affiliation_key(affiliation) in target_keys:
            await db.delete(affiliation)
        else:
            affiliation.person_id = target_person.id
            target_keys.add(_person_affiliation_key(affiliation))

    if not target_person.legal_name and source_person.legal_name:
        target_person.legal_name = source_person.legal_name
    if not target_person.note and source_person.note:
        target_person.note = source_person.note
    await db.delete(source_person)
    await db.flush()
    await person_svc.sync_pending_affiliations_for_person(db, target_person)


async def _merge_class_records(
    db: AsyncSession,
    *,
    target_user: User,
    source_user: User,
) -> None:
    """合併班級名冊、手動成員與幹部設定。"""
    target_roster = list(
        (
            await db.scalars(
                select(ClassRosterEntry).where(ClassRosterEntry.user_id == target_user.id)
            )
        ).all()
    )
    by_class = {row.class_id: row for row in target_roster}
    by_seat = {(row.class_id, row.seat_number): row for row in target_roster}
    source_roster = list(
        (
            await db.scalars(
                select(ClassRosterEntry).where(ClassRosterEntry.user_id == source_user.id)
            )
        ).all()
    )
    for row in source_roster:
        class_row = by_class.get(row.class_id)
        seat_row = by_seat.get((row.class_id, row.seat_number))
        if class_row is not None and class_row.student_id != row.student_id:
            raise UserRegistrationError(409, "兩個帳戶的班級名冊資料互相衝突，請先整理名冊")
        if (
            class_row is None
            and seat_row is not None
            and seat_row.id != row.id
            and seat_row.student_id != row.student_id
        ):
            raise UserRegistrationError(409, "兩個帳戶的班級座號資料互相衝突，請先整理名冊")

    for model in (ClassCadre, ClassManualMember):
        target_class_ids = set(
            (await db.scalars(select(model.class_id).where(model.user_id == target_user.id))).all()
        )
        source_rows = list(
            (await db.scalars(select(model).where(model.user_id == source_user.id))).all()
        )
        for row in source_rows:
            if row.class_id in target_class_ids:
                await db.delete(row)
            else:
                row.user_id = target_user.id
                target_class_ids.add(row.class_id)

    target_memberships = list(
        (
            await db.scalars(
                select(ClassMembership).where(ClassMembership.user_id == target_user.id)
            )
        ).all()
    )
    membership_keys = {
        (row.class_id, row.academic_year, row.status, row.start_date, row.end_date)
        for row in target_memberships
    }
    source_memberships = list(
        (
            await db.scalars(
                select(ClassMembership).where(ClassMembership.user_id == source_user.id)
            )
        ).all()
    )
    for row in source_memberships:
        key = (row.class_id, row.academic_year, row.status, row.start_date, row.end_date)
        if key in membership_keys:
            await db.delete(row)
        else:
            row.user_id = target_user.id
            membership_keys.add(key)

    for row in source_roster:
        class_row = by_class.get(row.class_id)
        seat_row = by_seat.get((row.class_id, row.seat_number))
        if class_row is not None:
            if class_row.student_id != row.student_id:
                raise UserRegistrationError(409, "兩個帳戶的班級名冊資料互相衝突，請先整理名冊")
            await db.delete(row)
            continue
        if seat_row is not None and seat_row.id != row.id:
            if seat_row.student_id != row.student_id:
                raise UserRegistrationError(409, "兩個帳戶的班級座號資料互相衝突，請先整理名冊")
            await db.delete(row)
            continue
        row.user_id = target_user.id
        by_class[row.class_id] = row
        by_seat[(row.class_id, row.seat_number)] = row
    await db.flush()


def student_id_from_school_email(email: str) -> str | None:
    local_part, separator, domain = email.strip().lower().partition("@")
    if separator and domain == SCHOOL_EMAIL_DOMAIN and local_part.startswith("g0"):
        student_id = local_part[2:]
        return student_id or None
    return None


async def pre_register_user(
    db: AsyncSession,
    *,
    student_id: str | None,
    email: str | None,
    linked_emails: list[str],
    display_name: str,
    position_ids: list[uuid.UUID],
    custom_permission_org_id: uuid.UUID | None,
    custom_permission_codes: list[str],
    start_date: date,
    end_date: date | None,
    actor: User,
) -> User:
    normalized_student_id = student_id.strip() if student_id else None
    normalized_email = email.strip().lower() if email else None
    if not normalized_email:
        if not normalized_student_id:
            raise UserRegistrationError(422, "未提供 email 時，student_id 為必填")
        normalized_email = f"g0{normalized_student_id}@{SCHOOL_EMAIL_DOMAIN}"

    all_emails = list(
        dict.fromkeys(
            address.strip().lower()
            for address in [normalized_email, *linked_emails]
            if address and address.strip()
        )
    )
    school_student_ids = {
        parsed
        for address in all_emails
        if (parsed := student_id_from_school_email(address)) is not None
    }
    if len(school_student_ids) > 1:
        raise UserRegistrationError(422, "多個校內 Email 對應到不同學號")
    parsed_student_id = next(iter(school_student_ids), None)
    if normalized_student_id and parsed_student_id and normalized_student_id != parsed_student_id:
        raise UserRegistrationError(422, "填寫的學號與校內 Email 不一致")
    normalized_student_id = normalized_student_id or parsed_student_id

    conditions = [User.email.in_(all_emails)]
    if normalized_student_id:
        conditions.append(User.student_id == normalized_student_id)
    duplicate = await db.scalar(select(User).where(or_(*conditions)))
    if duplicate:
        raise UserRegistrationError(409, "學號或 Email 已存在")
    linked_duplicate = await db.scalar(
        select(UserIdentity).where(UserIdentity.email.in_(all_emails))
    )
    if linked_duplicate:
        raise UserRegistrationError(409, "其中一個 Email 已連結其他帳號")

    positions: list[Position] = []
    if position_ids:
        result = await db.execute(
            select(Position)
            .options(selectinload(Position.org))
            .where(Position.id.in_(position_ids))
        )
        positions = list(result.scalars().all())
        position_map = {position.id: position for position in positions}
        for position_id in position_ids:
            position = position_map.get(position_id)
            if not position:
                raise UserRegistrationError(404, f"職位 {position_id} 不存在")
            if position.org and not position.org.is_active:
                raise UserRegistrationError(
                    409,
                    f"職位 {position.name} 所屬組織已停用，無法指派",
                )

    permission_codes = sorted(set(custom_permission_codes))
    custom_org: Org | None = None
    if permission_codes:
        invalid_codes = validate_permission_codes(permission_codes)
        if invalid_codes:
            raise UserRegistrationError(422, f"存在未知權限碼：{', '.join(invalid_codes)}")
        if custom_permission_org_id is None:
            raise UserRegistrationError(422, "使用自訂權限時，custom_permission_org_id 為必填")
        custom_org = await db.get(Org, custom_permission_org_id)
        if custom_org is None:
            raise UserRegistrationError(404, "自訂權限組織不存在")
        if not custom_org.is_active:
            raise UserRegistrationError(409, "自訂權限組織已停用，無法使用")

    user = User(
        email=normalized_email,
        display_name=display_name.strip(),
        student_id=normalized_student_id,
        is_verified=False,
        is_active=True,
        is_superuser=False,
    )
    db.add(user)
    await db.flush()

    now = datetime.now(UTC)
    for address in all_emails:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="email",
                external_id=address,
                email=address,
                display_name=user.display_name,
                linked_at=now,
            )
        )

    for position in positions:
        assignment = UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=start_date,
            end_date=end_date,
        )
        db.add(assignment)
        await db.flush()
        await person_svc.record_affiliation_for_user_position(
            db,
            user=user,
            kind=PersonAffiliationKind.ORG_POSITION,
            position_id=position.id,
            start_date=assignment.start_date,
            end_date=assignment.end_date,
            synced_user_position_id=assignment.id,
            source=PersonAffiliationSource.RBAC_SYNC,
        )

    if permission_codes and custom_org:
        custom_position = Position(
            org_id=custom_org.id,
            name=f"外部協作-{user.display_name}",
            description=f"系統自動建立：{user.email} 的自訂權限職位",
            category=PositionCategory.SYSTEM,
        )
        db.add(custom_position)
        await db.flush()
        for code in permission_codes:
            db.add(Permission(position_id=custom_position.id, code=code))
        db.add(
            UserPosition(
                user_id=user.id,
                position_id=custom_position.id,
                start_date=start_date,
                end_date=end_date,
            )
        )

    await db.flush()
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user.id),
        action="user.pre_register",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta={
            "email": user.email,
            "linked_emails": all_emails,
            "student_id": user.student_id,
            "position_ids": [str(position_id) for position_id in position_ids],
            "custom_permission_codes": permission_codes,
            "custom_permission_org_id": (
                str(custom_permission_org_id) if custom_permission_org_id else None
            ),
        },
        summary=f"預先建立使用者「{user.display_name}」",
    )
    return user


async def link_user_emails(
    db: AsyncSession,
    *,
    user: User,
    emails: list[str],
    actor: User,
    merge_existing_accounts: bool = False,
) -> User:
    normalized_emails = list(
        dict.fromkeys(address.strip().lower() for address in emails if address.strip())
    )
    if not normalized_emails:
        raise UserRegistrationError(422, "請至少提供一個 Email")

    school_student_ids = {
        parsed
        for address in normalized_emails
        if (parsed := student_id_from_school_email(address)) is not None
    }
    if len(school_student_ids) > 1:
        raise UserRegistrationError(422, "多個校內 Email 對應到不同學號")
    parsed_student_id = next(iter(school_student_ids), None)
    if user.student_id and parsed_student_id and user.student_id != parsed_student_id:
        raise UserRegistrationError(422, "校內 Email 的學號與帳號既有學號不一致")

    other_user_ids = set(
        (
            await db.scalars(
                select(User.id).where(User.email.in_(normalized_emails), User.id != user.id)
            )
        ).all()
    )
    other_user_ids.update(
        (
            await db.scalars(
                select(UserIdentity.user_id).where(
                    UserIdentity.email.in_(normalized_emails),
                    UserIdentity.user_id != user.id,
                )
            )
        ).all()
    )
    if other_user_ids and not merge_existing_accounts:
        raise UserRegistrationError(409, "此 Email 已屬於其他帳號，請使用帳戶合併功能")
    other_users: list[User] = []
    candidate_student_id = user.student_id or parsed_student_id
    if merge_existing_accounts:
        for other_user_id in other_user_ids:
            other_user = await db.get(User, other_user_id)
            if other_user is None:
                continue
            if (
                candidate_student_id
                and other_user.student_id
                and candidate_student_id != other_user.student_id
            ):
                raise UserRegistrationError(422, "要合併的帳戶學號不一致")
            candidate_student_id = candidate_student_id or other_user.student_id
            other_users.append(other_user)

    if candidate_student_id and not user.student_id:
        user.student_id = candidate_student_id

    for other_user in other_users:
        await merge_user_accounts(db, user=user, source_user=other_user, actor=actor)

    existing_emails = set(
        (
            await db.scalars(
                select(UserIdentity.email).where(
                    UserIdentity.user_id == user.id,
                    UserIdentity.email.in_(normalized_emails),
                )
            )
        ).all()
    )
    now = datetime.now(UTC)
    for address in normalized_emails:
        if address not in existing_emails:
            db.add(
                UserIdentity(
                    user_id=user.id,
                    provider="email",
                    external_id=address,
                    email=address,
                    display_name=user.display_name,
                    linked_at=now,
                )
            )
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user.id),
        action="user.email_link",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta={"emails": normalized_emails},
        summary=f"連結使用者「{user.display_name}」的登入 Email",
    )
    return user


async def _merge_login_identities(
    db: AsyncSession,
    *,
    user: User,
    other_user: User,
    actor: User,
) -> None:
    """將次要帳戶的登入身分、設定、權限與所有歷史資料歸戶。"""
    if other_user.id == user.id:
        return

    source_student_id = other_user.student_id
    if user.student_id and source_student_id and user.student_id != source_student_id:
        raise UserRegistrationError(422, "要合併的帳戶學號不一致")
    if source_student_id and not user.student_id:
        # users.student_id 有唯一索引；先釋放次要帳戶的值，避免資料庫
        # 先 flush 主要帳戶而在同一個 transaction 內撞到唯一鍵。
        other_user.student_id = None
        await db.flush()
        user.student_id = source_student_id
    if source_student_id == user.student_id:
        # users.student_id 是唯一欄位，先釋放次要帳戶的值才能把校務學號
        # 套用到主要帳戶；Person 檔案仍保留原始學號快照。
        other_user.student_id = None
    await _preflight_user_record_reparenting(
        db,
        target_user_id=user.id,
        source_user_id=other_user.id,
    )

    await _merge_class_records(db, target_user=user, source_user=other_user)

    if other_user.notification_preferences:
        user.notification_preferences = {
            **other_user.notification_preferences,
            **(user.notification_preferences or {}),
        }
    if user.ui_theme == "auto" and other_user.ui_theme != "auto":
        user.ui_theme = other_user.ui_theme
    if user.ui_locale == "zh-TW" and other_user.ui_locale != "zh-TW":
        user.ui_locale = other_user.ui_locale
    user.is_verified = user.is_verified or other_user.is_verified
    if user.avatar_url is None:
        user.avatar_url = other_user.avatar_url

    identities = list(
        (await db.scalars(select(UserIdentity).where(UserIdentity.user_id == other_user.id))).all()
    )
    existing_keys = {
        (provider, external_id)
        for provider, external_id in (
            await db.execute(
                select(UserIdentity.provider, UserIdentity.external_id).where(
                    UserIdentity.user_id == user.id
                )
            )
        ).all()
    }
    for identity in identities:
        key = (identity.provider, identity.external_id)
        if key in existing_keys:
            await db.delete(identity)
            continue
        identity.user_id = user.id
        existing_keys.add(key)

    if other_user.google_sub:
        google_key = ("google", other_user.google_sub)
        if google_key in existing_keys:
            other_user.google_sub = None
        elif user.google_sub is None:
            user.google_sub = other_user.google_sub
            other_user.google_sub = None
        else:
            db.add(
                UserIdentity(
                    user_id=user.id,
                    provider="google",
                    external_id=other_user.google_sub,
                    email=other_user.email,
                    display_name=other_user.display_name,
                    linked_at=datetime.now(UTC),
                )
            )
            existing_keys.add(google_key)
            other_user.google_sub = None

    await _reparent_user_records(
        db,
        target_user_id=user.id,
        source_user_id=other_user.id,
    )
    await _merge_person_profiles(db, target_user=user, source_user=other_user)
    other_user.email = f"merged-{other_user.id}@deleted.local"
    other_user.is_active = False
    await db.flush()
    await cache_invalidate_user_permissions(str(user.id))
    await cache_invalidate_user_permissions(str(other_user.id))
    await enqueue_role_sync(db, user.id)
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user.id),
        action="user.account_merge",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta={
            "merged_user_id": str(other_user.id),
            "student_id": user.student_id,
            "scope": "identities_and_user_records",
        },
        summary=f"將帳號「{other_user.display_name}」的身分與歷史資料歸戶至「{user.display_name}」",
    )


async def merge_user_accounts(
    db: AsyncSession,
    *,
    user: User,
    source_user: User | None = None,
    source_users: Iterable[User] | None = None,
    actor: User,
    conflict_resolutions: dict[str, str] | None = None,
) -> User:
    """公開的管理員帳戶合併入口；user 是保留的主要帳戶。"""
    sources = list(source_users or ([] if source_user is None else [source_user]))
    if not sources:
        raise UserRegistrationError(422, "至少要選擇一個次要帳戶")
    if any(item.id == user.id for item in sources):
        raise UserRegistrationError(422, "不可合併主要帳戶本身")
    if len({item.id for item in sources}) != len(sources):
        raise UserRegistrationError(422, "次要帳戶不可重複")

    conflicts = await collect_merge_conflicts(
        db,
        target_user=user,
        source_users=sources,
    )
    resolutions = conflict_resolutions or {}
    conflict_keys = {conflict["key"] for conflict in conflicts}
    unknown_keys = set(resolutions) - conflict_keys
    if unknown_keys:
        raise UserRegistrationError(422, "包含不存在的衝突選項，請重新預覽後再合併")
    unresolved = [
        _public_merge_conflict(conflict)
        for conflict in conflicts
        if conflict["key"] not in resolutions
    ]
    if unresolved:
        raise UserRegistrationError(
            409,
            "帳戶資料存在衝突，請先選擇要保留的資料",
            payload={"conflicts": unresolved},
        )
    for conflict in conflicts:
        selected_id = resolutions[conflict["key"]]
        if selected_id not in {record["id"] for record in conflict["records"]}:
            raise UserRegistrationError(422, f"衝突選擇無效：{conflict['title']}")

    await _apply_record_conflict_resolutions(
        db,
        conflicts=conflicts,
        resolutions=resolutions,
    )
    await _apply_field_conflict_resolutions(
        db,
        target_user=user,
        source_users=sources,
        conflicts=conflicts,
        resolutions=resolutions,
    )
    for source in sources:
        await _merge_login_identities(db, user=user, other_user=source, actor=actor)
    return user


async def preview_merge_user_accounts(
    db: AsyncSession,
    *,
    user: User,
    source_users: Iterable[User],
) -> list[dict[str, Any]]:
    """預覽管理員帳戶合併衝突；不會寫入資料庫。"""
    sources = list(source_users)
    if not sources:
        raise UserRegistrationError(422, "至少要選擇一個次要帳戶")
    if any(item.id == user.id for item in sources):
        raise UserRegistrationError(422, "不可合併主要帳戶本身")
    if len({item.id for item in sources}) != len(sources):
        raise UserRegistrationError(422, "次要帳戶不可重複")
    return [
        _public_merge_conflict(conflict)
        for conflict in await collect_merge_conflicts(
            db,
            target_user=user,
            source_users=sources,
        )
    ]
