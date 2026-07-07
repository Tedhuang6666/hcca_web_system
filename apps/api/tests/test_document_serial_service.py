"""公文服務層（_serial.py）字號生成 / 字號模板 CRUD 測試 — 真實 DB session。

generate_serial_from_template 使用 SELECT FOR UPDATE 鎖模板列並原子性遞增流水號，
build_org_serial_prefix 用遞迴 CTE 沿組織樹逐層組合前綴。兩者都需要真實 Postgres
才能正確驗證（SQLite 不支援遞迴 CTE 語法差異與 FOR UPDATE 鎖語意）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import now_local
from api.models.document import DocumentSerialTemplate, YearMode
from api.models.org import Org
from api.schemas.document import SerialTemplateCreate
from api.services.document import (
    build_org_serial_prefix,
    create_serial_template,
    deactivate_serial_template,
    generate_serial_from_template,
    get_serial_template,
    list_serial_templates,
    update_serial_template,
)

pytestmark = pytest.mark.asyncio


async def _make_org(db_session: AsyncSession, **overrides: object) -> Org:
    defaults: dict = {"name": f"組織-{uuid.uuid4().hex[:6]}"}
    defaults.update(overrides)
    org = Org(**defaults)
    db_session.add(org)
    await db_session.flush()
    return org


# ── build_org_serial_prefix ──────────────────────────────────────────────────


async def test_build_org_serial_prefix_missing_org_raises(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="不存在"):
        await build_org_serial_prefix(db_session, uuid.uuid4())


async def test_build_org_serial_prefix_combines_ancestor_chain(
    db_session: AsyncSession,
) -> None:
    grandparent = await _make_org(db_session, prefix="嶺")
    parent = await _make_org(db_session, prefix="代", parent_id=grandparent.id)
    child = await _make_org(db_session, prefix="生", parent_id=parent.id)

    prefix = await build_org_serial_prefix(db_session, child.id)

    assert prefix == "嶺代生"


async def test_build_org_serial_prefix_skips_orgs_without_prefix(
    db_session: AsyncSession,
) -> None:
    grandparent = await _make_org(db_session, prefix="嶺")
    parent = await _make_org(db_session, prefix=None, parent_id=grandparent.id)
    child = await _make_org(db_session, prefix="生", parent_id=parent.id)

    prefix = await build_org_serial_prefix(db_session, child.id)

    assert prefix == "嶺生"


async def test_build_org_serial_prefix_raises_when_no_org_has_prefix(
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session, prefix=None)

    with pytest.raises(ValueError, match="尚未設定任何字號前綴"):
        await build_org_serial_prefix(db_session, org.id)


async def test_build_org_serial_prefix_too_long_raises(db_session: AsyncSession) -> None:
    """組合後的前綴超過 20 字時應拒絕（各層 prefix 本身仍在欄位長度限制內）。"""
    parent = await _make_org(db_session, prefix="一二三四五六七八九十一二三四五")  # 15 字
    child = await _make_org(
        db_session, prefix="甲乙丙丁戊己庚辛壬", parent_id=parent.id
    )  # +9 字 = 24

    with pytest.raises(ValueError, match="超過 20 字"):
        await build_org_serial_prefix(db_session, child.id)


# ── generate_serial_from_template ────────────────────────────────────────────


async def test_generate_serial_from_template_increments_counter(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    template = DocumentSerialTemplate(
        org_id=org.id,
        org_prefix="嶺代",
        category_char="生",
        year_mode=YearMode.ROC,
        current_year=now_local().year - 1911,
        counter=5,
        is_active=True,
        created_by=creator.id,
    )
    db_session.add(template)
    await db_session.flush()

    serial1 = await generate_serial_from_template(db_session, template)
    serial2 = await generate_serial_from_template(db_session, template)

    assert "0000006" in serial1
    assert "0000007" in serial2


async def test_generate_serial_from_template_resets_counter_on_new_year(
    db_session: AsyncSession, make_user
) -> None:
    """reset_on_new_year=True 且模板年份落後時，應重置計數器為 1。"""
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    current_year = now_local().year - 1911
    template = DocumentSerialTemplate(
        org_id=org.id,
        org_prefix="嶺代",
        category_char="生",
        year_mode=YearMode.ROC,
        current_year=current_year - 1,
        counter=99,
        reset_on_new_year=True,
        is_active=True,
        created_by=creator.id,
    )
    db_session.add(template)
    await db_session.flush()

    serial = await generate_serial_from_template(db_session, template)

    assert f"{current_year}0000001" in serial
    assert template.counter == 1
    assert template.current_year == current_year


# ── create_serial_template ───────────────────────────────────────────────────


async def test_create_serial_template_success(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()

    template = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="生"),
        created_by=creator.id,
    )

    assert template.org_prefix == "嶺代"
    assert template.counter == 0
    assert template.is_active is True


async def test_create_serial_template_as_default_clears_sibling_default(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    old_default = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="生", is_default=True),
        created_by=creator.id,
    )
    assert old_default.is_default is True

    new_default = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="議", is_default=True),
        created_by=creator.id,
    )

    await db_session.refresh(old_default)
    assert old_default.is_default is False
    assert new_default.is_default is True


async def test_create_serial_template_president_publish_default_is_global(
    db_session: AsyncSession, make_user
) -> None:
    """主席公布預設模板全站唯一，不同組織也需互斥。"""
    org1 = await _make_org(db_session, prefix="嶺代")
    org2 = await _make_org(db_session, prefix="嶺學")
    creator = await make_user()
    first = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(
            org_id=org1.id, category_char="令", is_default_president_publish=True
        ),
        created_by=creator.id,
    )

    second = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(
            org_id=org2.id, category_char="令", is_default_president_publish=True
        ),
        created_by=creator.id,
    )

    await db_session.refresh(first)
    assert first.is_default_president_publish is False
    assert second.is_default_president_publish is True


# ── get / list / deactivate / update ────────────────────────────────────────


async def test_get_serial_template_missing_returns_none(db_session: AsyncSession) -> None:
    assert await get_serial_template(db_session, uuid.uuid4()) is None


async def test_list_serial_templates_filters_active_only(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    active = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="生"),
        created_by=creator.id,
    )
    inactive = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="議"),
        created_by=creator.id,
    )
    await deactivate_serial_template(db_session, inactive)

    results = await list_serial_templates(db_session, org_id=org.id)

    assert {t.id for t in results} == {active.id}


async def test_deactivate_serial_template_clears_default_flags(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    template = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="生", is_default=True),
        created_by=creator.id,
    )

    result = await deactivate_serial_template(db_session, template)

    assert result.is_active is False
    assert result.is_default is False


async def test_update_serial_template_setting_default_clears_siblings(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    t1 = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="生", is_default=True),
        created_by=creator.id,
    )
    t2 = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="議"),
        created_by=creator.id,
    )

    await update_serial_template(db_session, t2, updates={"is_default": True})

    await db_session.refresh(t1)
    assert t1.is_default is False
    assert t2.is_default is True


async def test_update_serial_template_deactivating_clears_default_flags(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    template = await create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="生", is_default=True),
        created_by=creator.id,
    )

    result = await update_serial_template(db_session, template, updates={"is_active": False})

    assert result.is_default is False
    assert result.is_default_president_publish is False
