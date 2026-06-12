"""字號自動生成 + 字號模板 CRUD"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import bindparam, select, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import now_local
from api.models.document import DocumentSerialTemplate, YearMode
from api.schemas.document import SerialTemplateCreate

logger = logging.getLogger(__name__)


async def generate_serial_from_template(
    session: AsyncSession,
    template: DocumentSerialTemplate,
) -> str:
    """以組織字號模板原子性生成字號（SELECT FOR UPDATE）。"""
    now = now_local()
    current_year = now.year - 1911 if template.year_mode == YearMode.ROC else now.year

    result = await session.execute(
        select(DocumentSerialTemplate)
        .where(DocumentSerialTemplate.id == template.id)
        .with_for_update()
    )
    locked_template = result.scalar_one()

    if locked_template.reset_on_new_year and locked_template.current_year != current_year:
        locked_template.current_year = current_year
        locked_template.counter = 1
    else:
        locked_template.counter += 1

    counter_val = locked_template.counter
    await session.flush()

    return (
        f"{locked_template.org_prefix}{locked_template.category_char}"
        f"字第 {current_year}{counter_val:07d} 號"
    )


async def build_org_serial_prefix(session: AsyncSession, org_id: uuid.UUID) -> str:
    result = await session.execute(
        text("""
        WITH RECURSIVE org_path AS (
            SELECT id, parent_id, prefix, name, 0 AS depth
            FROM orgs
            WHERE id = :org_id
            UNION ALL
            SELECT o.id, o.parent_id, o.prefix, o.name, org_path.depth + 1
            FROM orgs o
            JOIN org_path ON o.id = org_path.parent_id
        )
        SELECT prefix, name, depth
        FROM org_path
        ORDER BY depth DESC
        """).bindparams(bindparam("org_id", value=org_id, type_=PGUUID(as_uuid=True))),
    )
    rows = result.all()
    if not rows:
        raise ValueError("指定的組織不存在")

    parts = [str(row.prefix).strip() for row in rows if row.prefix and str(row.prefix).strip()]
    if not parts:
        org_name = next((row.name for row in rows if row.depth == 0), rows[-1].name)
        raise ValueError(f"組織「{org_name}」及其上層組織尚未設定任何字號前綴")

    prefix = "".join(parts)
    if len(prefix) > 20:
        raise ValueError("組織階層字號前綴合併後超過 20 字，請縮短各層前綴")
    return prefix


async def create_serial_template(
    session: AsyncSession,
    *,
    data: SerialTemplateCreate,
    created_by: uuid.UUID,
) -> DocumentSerialTemplate:
    prefix = await build_org_serial_prefix(session, data.org_id)
    now = now_local()
    current_year = now.year - 1911 if data.year_mode == YearMode.ROC else now.year

    template = DocumentSerialTemplate(
        org_id=data.org_id,
        org_prefix=prefix,
        category_char=data.category_char,
        year_mode=data.year_mode,
        reset_on_new_year=data.reset_on_new_year,
        current_year=current_year,
        counter=0,
        is_active=True,
        is_default=data.is_default,
        is_default_president_publish=data.is_default_president_publish,
        description=data.description,
        created_by=created_by,
    )
    session.add(template)
    await session.flush()
    if template.is_default:
        result = await session.execute(
            select(DocumentSerialTemplate).where(
                DocumentSerialTemplate.org_id == template.org_id,
                DocumentSerialTemplate.id != template.id,
            )
        )
        for sibling in result.scalars().all():
            if sibling.is_default:
                sibling.is_default = False
        await session.flush()
    if template.is_default_president_publish:
        result = await session.execute(
            select(DocumentSerialTemplate).where(DocumentSerialTemplate.id != template.id)
        )
        for sibling in result.scalars().all():
            if sibling.is_default_president_publish:
                sibling.is_default_president_publish = False
        await session.flush()
    logger.info(
        "字號模板建立 id=%s org_id=%s prefix=%s%s",
        template.id,
        data.org_id,
        prefix,
        data.category_char,
    )
    return template


async def get_serial_template(
    session: AsyncSession,
    template_id: uuid.UUID,
) -> DocumentSerialTemplate | None:
    result = await session.execute(
        select(DocumentSerialTemplate).where(DocumentSerialTemplate.id == template_id)
    )
    return result.scalar_one_or_none()


async def list_serial_templates(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    active_only: bool = True,
) -> list[DocumentSerialTemplate]:
    q = select(DocumentSerialTemplate)
    if org_id:
        q = q.where(DocumentSerialTemplate.org_id == org_id)
    if active_only:
        q = q.where(DocumentSerialTemplate.is_active.is_(True))
    q = q.order_by(
        DocumentSerialTemplate.is_default_president_publish.desc(),
        DocumentSerialTemplate.is_default.desc(),
        DocumentSerialTemplate.org_prefix,
        DocumentSerialTemplate.category_char,
    )
    result = await session.execute(q)
    return list(result.scalars().all())


async def deactivate_serial_template(
    session: AsyncSession,
    template: DocumentSerialTemplate,
) -> DocumentSerialTemplate:
    template.is_active = False
    template.is_default = False
    template.is_default_president_publish = False
    await session.flush()
    return template


async def update_serial_template(
    session: AsyncSession,
    template: DocumentSerialTemplate,
    *,
    updates: dict,
) -> DocumentSerialTemplate:
    for field, value in updates.items():
        setattr(template, field, value)
    if not template.is_active:
        template.is_default = False
        template.is_default_president_publish = False
    await session.flush()
    if template.is_default:
        result = await session.execute(
            select(DocumentSerialTemplate).where(
                DocumentSerialTemplate.org_id == template.org_id,
                DocumentSerialTemplate.id != template.id,
            )
        )
        for sibling in result.scalars().all():
            if sibling.is_default:
                sibling.is_default = False
        await session.flush()
    if template.is_default_president_publish:
        result = await session.execute(
            select(DocumentSerialTemplate).where(DocumentSerialTemplate.id != template.id)
        )
        for sibling in result.scalars().all():
            if sibling.is_default_president_publish:
                sibling.is_default_president_publish = False
        await session.flush()
    return template
