"""教師／組織表單轉入既有訂單、庫存、應收與 transactional outbox。"""

import hashlib
import json
import uuid
from collections import Counter
from datetime import UTC, datetime

from pydantic import TypeAdapter
from pydantic.networks import EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory, ProductStatus
from api.models.shop_sheet import ShopSheetRow, ShopSheetSource
from api.schemas.shop_sheet import ShopSheetConfig, ShopSheetSyncOut
from api.services import receivable
from api.services.outbox import emit, request_processing_after_commit
from api.services.shop._catalog import generate_order_serial, get_product
from api.services.shop._orders import (
    _assert_product_registration_open,
    _options_delta,
    _product_category_filter,
    _product_order_scope,
    _resolve_selected_options,
)
from api.services.shop._purchase_rules import product_purchase_restriction
from api.services.shop._sheet_parser import (
    AnswerNeedsReview,
    normalize,
    parse_answer,
    product_label,
)
from api.services.shop._sheet_reader import SheetReadError, read_sheet


def _hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


def _cell(row: dict[str, str], column: str) -> str:
    return row.get(column, "").strip()


async def _build_order(
    session: AsyncSession,
    source: ShopSheetSource,
    config: ShopSheetConfig,
    row: dict[str, str],
) -> Order:
    name = _cell(row, config.name_column)
    office = _cell(row, config.office_column)
    other_office = _cell(row, config.other_office_column) if config.other_office_column else ""
    if other_office:
        office = other_office
    if not name or not office or len(name) > 100 or len(office) > 100:
        raise AnswerNeedsReview("姓名與辦公室／組織必須填寫，且各不得超過 100 字")
    try:
        email = str(TypeAdapter(EmailStr).validate_python(_cell(row, config.email_column)))
    except ValueError as exc:
        raise AnswerNeedsReview("缺少有效的自動收集 Email，請補齊通知信箱") from exc
    metadata_columns = {
        config.identity_column,
        config.name_column,
        config.email_column,
        config.office_column,
        config.other_office_column,
        *config.ignored_columns,
    }
    product_ids = list(
        await session.scalars(
            select(Product.id)
            .where(_product_category_filter(source.category_id))
            .order_by(Product.id)
        )
    )
    # 以固定次序鎖庫存，避免不同來源互鎖。
    if product_ids:
        await session.execute(
            select(Product)
            .where(Product.id.in_(product_ids))
            .order_by(Product.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    products = [await get_product(session, product_id) for product_id in product_ids]
    products = [product for product in products if product is not None]
    by_id = {product.id: product for product in products}
    items: list[OrderItem] = []
    quantities: Counter[uuid.UUID] = Counter()
    for header, answer in row.items():
        if header in metadata_columns or not answer.strip():
            continue
        explicit_id = config.product_columns.get(header)
        candidates = (
            ([by_id[explicit_id]] if explicit_id in by_id else [])
            if explicit_id
            else [
                product
                for product in products
                if product_label(product.name) == product_label(header)
            ]
        )
        # 空白／明確不訂購不需要對應商品；其餘未對應的欄位不可靜默略過。
        if normalize(answer) in {"0", "無", "不要", "不需要", "不訂購", "-", "—"}:
            continue
        if len(candidates) != 1:
            raise AnswerNeedsReview(f"欄位「{header[:100]}」無法唯一對應本主題商品，請設定欄位對應")
        product = candidates[0]
        groups = product.variant_groups
        if len(groups) > 1:
            raise AnswerNeedsReview(f"商品「{product.name}」有多組規格，需人工確認完整組合")
        options = [option for group in groups for option in group.options if option.is_active]
        parsed = parse_answer(answer, [option.value for option in options])
        for variant in parsed:
            option_ids = [option.id for option in options if option.value == variant.value]
            selected = _resolve_selected_options(product, option_ids)
            items.append(
                OrderItem(
                    product_id=product.id,
                    quantity=variant.quantity,
                    unit_price=product.price + _options_delta(selected),
                    selected_options=selected,
                    ordered_by_name=name,
                )
            )
            quantities[product.id] += variant.quantity
    if not items:
        raise AnswerNeedsReview("沒有可建立的訂購品項")
    for product_id, quantity in quantities.items():
        product = by_id[product_id]
        await _assert_product_registration_open(session, product, class_id=None)
        if (
            await product_purchase_restriction(session, product, None)
            or product.max_quantity_per_user is not None
            or product.requires_seating
        ):
            raise AnswerNeedsReview(f"商品「{product.name}」有限購或身分限制，需人工確認")
        if not product.is_unlimited:
            if product.stock_quantity < quantity:
                raise AnswerNeedsReview(f"商品「{product.name}」庫存不足")
            product.stock_quantity -= quantity
            if product.stock_quantity == 0:
                product.status = ProductStatus.SOLD_OUT
    category = await session.get(ProductCategory, source.category_id)
    if category is None:
        raise AnswerNeedsReview("來源商品主題不存在")
    total = sum(item.quantity * item.unit_price for item in items)
    scope = _product_order_scope(by_id[items[0].product_id])
    order = Order(
        serial_number=await generate_order_serial(session),
        user_id=None,
        class_id=None,
        activity_id=scope[0],
        category_id=scope[1],
        status=OrderStatus.CONFIRMED,
        assistance_scope="sheet_import",
        payment_method="cash_on_pickup",
        is_paid=False,
        is_class_collected=False,
        buyer_name=name,
        buyer_office=office,
        subtotal_price=total,
        total_price=total,
        discount_amount=0,
        notes=f"組織表單預購：{source.name}；交貨時付款",
        items=items,
        applied_promotions=[],
    )
    session.add(order)
    await session.flush()
    await receivable.sync_shop_order(session, order)
    await emit(
        session,
        event_type="shop.order_confirmed",
        payload={
            "order_id": str(order.id),
            "serial_number": order.serial_number,
            "buyer_email": email,
            "buyer_name": name,
            "buyer_office": office,
            "external_preorder": True,
            "payment_method": "cash_on_pickup",
            "subtotal_price": total,
            "discount_amount": 0,
            "total_price": total,
            "items": [
                {
                    "product_name": by_id[item.product_id].name,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": item.quantity * item.unit_price,
                    "selected_options": item.selected_options,
                }
                for item in items
            ],
        },
    )
    request_processing_after_commit(session)
    return order


async def import_rows(
    session: AsyncSession, source: ShopSheetSource, values: list[list[str]]
) -> ShopSheetSyncOut:
    """呼叫端須鎖定 source；一列失敗只回滾該列，不保留半筆訂單或扣庫存。"""
    config = ShopSheetConfig.model_validate(source.config)
    if not values:
        raise SheetReadError("工作表沒有標題列")
    headers = [header.strip() for header in values[0]]
    if not all(headers) or len(set(headers)) != len(headers):
        raise SheetReadError("標題欄位有空白或重複名稱，請先修正")
    required = {
        config.identity_column,
        config.name_column,
        config.email_column,
        config.office_column,
    }
    if not required.issubset(headers):
        raise SheetReadError("工作表缺少時間／識別碼、姓名、Email 或辦公室欄位")
    if any(len(row) > len(headers) and any(row[len(headers) :]) for row in values[1:]):
        raise SheetReadError("資料超出標題欄位，請補齊標題")
    rows = [
        (number, dict(zip(headers, row, strict=False)))
        for number, row in enumerate(values[1:], 2)
        if any(cell.strip() for cell in row)
    ]
    identities = Counter(_cell(row, config.identity_column) for _, row in rows)
    present_keys = {_hash(identity) for identity in identities if identity}
    previous_records = list(
        await session.scalars(select(ShopSheetRow).where(ShopSheetRow.source_id == source.id))
    )
    missing_imported_by_row = {
        record.row_number: record
        for record in previous_records
        if record.order_ids and record.response_key not in present_keys
    }
    result = ShopSheetSyncOut()
    for number, row in rows:
        identity = _cell(row, config.identity_column)
        key = _hash(identity) if identity else _hash(["missing", number])
        # 忽略空值欄位：新增無填答的表單欄位不應使舊單變更。
        digest = _hash({header: value.strip() for header, value in row.items() if value.strip()})
        record = await session.scalar(
            select(ShopSheetRow).where(
                ShopSheetRow.source_id == source.id, ShopSheetRow.response_key == key
            )
        )
        if record is None:
            previous = missing_imported_by_row.get(number)
            if previous is not None:
                previous.status = "changed"
                previous.error = "原列的識別碼／時間戳記已變更或被替換，請核對原訂單；未重複建單"
                result.review += 1
                continue
            record = ShopSheetRow(
                source_id=source.id,
                response_key=key,
                content_hash=digest,
                row_number=number,
                order_ids=[],
            )
            session.add(record)
            await session.flush()
        record.row_number = number
        if not identity or identities[identity] != 1:
            record.status = "review"
            record.error = "識別碼／時間戳記缺漏或重複；請提供每筆回覆唯一且固定的識別碼"
            result.review += 1
            continue
        if record.order_ids:
            if record.content_hash != digest:
                record.status = "changed"
                record.error = "已成立的訂單與表單內容不同，請管理者核對；未覆寫訂單或重寄通知"
                result.review += 1
            else:
                record.status = "imported"
                record.error = None
                result.skipped += 1
            continue
        record.content_hash = digest
        try:
            async with session.begin_nested():
                order = await _build_order(session, source, config, row)
                record.order_ids = [str(order.id)]
                record.status = "imported"
                record.error = None
                await session.flush()
            result.imported += 1
        except ValueError as exc:
            # rollback 到 savepoint 後重新讀，避免 ORM expired 欄位觸發隱式 I/O。
            record = await session.scalar(
                select(ShopSheetRow).where(
                    ShopSheetRow.source_id == source.id, ShopSheetRow.response_key == key
                )
            )
            assert record is not None
            record.status = "review"
            record.error = str(exc)[:500]
            result.review += 1
    await session.flush()
    return result


async def sync_source(session: AsyncSession, source_id: uuid.UUID) -> ShopSheetSyncOut:
    source = await session.scalar(
        select(ShopSheetSource)
        .where(ShopSheetSource.id == source_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if source is None:
        raise LookupError("找不到此匯入來源")
    config = ShopSheetConfig.model_validate(source.config)
    try:
        values = await read_sheet(source.spreadsheet_id, source.sheet_name, config.max_rows)
        result = await import_rows(session, source, values)
        source.last_error = None
        source.last_synced_at = datetime.now(UTC)
        return result
    except SheetReadError as exc:
        source.last_error = str(exc)[:500]
        source.last_synced_at = datetime.now(UTC)
        # 保留來源診斷；不把 exception 傳出導致 router rollback 診斷。
        return ShopSheetSyncOut(review=1)
