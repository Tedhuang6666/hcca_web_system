"""教師／組織表單轉入既有訂單、庫存、應收與 transactional outbox。"""

import hashlib
import json
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import TypeAdapter
from pydantic.networks import EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.outbox import OutboxEvent
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory, ProductStatus
from api.models.shop_sheet import ShopSheetRow, ShopSheetSource
from api.schemas.shop_sheet import ShopSheetConfig, ShopSheetSyncOut
from api.services import receivable
from api.services.outbox import emit, request_processing_after_commit
from api.services.shop._catalog import generate_order_serial, get_product
from api.services.shop._orders import (
    _apply_order_promotion,
    _assert_product_registration_open,
    _options_delta,
    _order_detail_query,
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


def _response_hash(name: str, email: str, office: str, items: list[dict]) -> str:
    quantities: Counter[tuple[str, tuple[str, ...]]] = Counter()
    for item in items:
        options = tuple(sorted(str(option["option_id"]) for option in item["selected_options"]))
        quantities[str(item["product_id"]), options] += item["quantity"]
    return _hash(
        {
            "name": name.strip(),
            "email": email.strip().casefold(),
            "office": office.strip(),
            "items": sorted(
                (product, options, count) for (product, options), count in quantities.items()
            ),
        }
    )


@dataclass
class _ParsedResponse:
    name: str
    email: str
    office: str
    products: dict[uuid.UUID, Product]
    items: list[OrderItem]
    quantities: Counter[uuid.UUID]

    @property
    def response_hash(self) -> str:
        return _response_hash(
            self.name,
            self.email,
            self.office,
            [
                {
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "selected_options": item.selected_options,
                }
                for item in self.items
            ],
        )


def _previous_response_hash(payload: dict, products: dict[uuid.UUID, Product]) -> str:
    if payload.get("response_hash"):
        return str(payload["response_hash"])
    # 舊通知未存商品 ID；以已確認的系統商品名稱精確對應，不能拿現在的訂單
    # 當原填答，否則欄名異動會覆寫管理者另外修改的訂單。
    items = []
    for item in payload.get("items", []):
        matches = [
            product.id for product in products.values() if product.name == item["product_name"]
        ]
        if len(matches) != 1:
            raise AnswerNeedsReview("原通知的商品無法唯一對應，請管理者核對原回覆")
        items.append({**item, "product_id": matches[0]})
    return _response_hash(
        str(payload.get("buyer_name") or ""),
        str(payload.get("buyer_email") or ""),
        str(payload.get("buyer_office") or ""),
        items,
    )


async def _parse_response(
    session: AsyncSession,
    source: ShopSheetSource,
    config: ShopSheetConfig,
    row: dict[str, str],
    *,
    existing_product_ids: set[uuid.UUID],
) -> _ParsedResponse:
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
    product_ids = sorted(set(product_ids) | existing_product_ids)
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
        if explicit_id is None:
            mapped_ids = {
                product_id
                for label, product_id in config.product_columns.items()
                if product_label(label) == product_label(header)
            }
            if len(mapped_ids) > 1:
                raise AnswerNeedsReview(f"欄位「{header[:100]}」有多個商品對應，請核對設定")
            explicit_id = next(iter(mapped_ids), None)
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
            raise AnswerNeedsReview(f"欄位「{header[:100]}」無法唯一對應本活動商品，請設定欄位對應")
        product = candidates[0]
        groups = product.variant_groups
        if len(groups) > 1:
            raise AnswerNeedsReview(f"商品「{product.name}」有多組規格，需人工確認完整組合")
        options = [option for group in groups for option in group.options if option.is_active]
        default_option_id = config.quantity_only_options.get(product.id)
        if default_option_id is not None:
            default_option = next(
                (option for option in options if option.id == default_option_id), None
            )
            if default_option is None or default_option.price_delta != 0:
                raise AnswerNeedsReview(
                    f"商品「{product.name}」的預設選項失效或有加價，請管理者核對"
                )
            parsed = parse_answer(answer, [])
        else:
            parsed = parse_answer(answer, [option.value for option in options])
        for variant in parsed:
            option_ids = (
                [default_option_id]
                if default_option_id is not None
                else [option.id for option in options if option.value == variant.value]
            )
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
    return _ParsedResponse(name, email, office, by_id, items, quantities)


async def _build_order(
    session: AsyncSession,
    source: ShopSheetSource,
    config: ShopSheetConfig,
    row: dict[str, str],
    *,
    order: Order | None = None,
    parsed: _ParsedResponse | None = None,
) -> Order:
    updating = order is not None
    old_quantities: Counter[uuid.UUID] = Counter()
    if order is not None:
        for item in order.items:
            old_quantities[item.product_id] += item.quantity
    parsed = parsed or await _parse_response(
        session, source, config, row, existing_product_ids=set(old_quantities)
    )
    name, email, office = parsed.name, parsed.email, parsed.office
    by_id, items, quantities = parsed.products, parsed.items, parsed.quantities
    scopes = {_product_order_scope(by_id[item.product_id]) for item in items}
    if len(scopes) != 1 or (
        order is not None and next(iter(scopes)) != (order.activity_id, order.category_id)
    ):
        raise AnswerNeedsReview("同一筆訂單只能包含原活動的商品，請管理者核對來源設定")
    for product_id in sorted(set(quantities) | set(old_quantities)):
        product = by_id[product_id]
        await _assert_product_registration_open(
            session, product, class_id=None, allow_sold_out=product_id in old_quantities
        )
        if (
            await product_purchase_restriction(session, product, None)
            or product.max_quantity_per_user is not None
            or product.requires_seating
        ):
            raise AnswerNeedsReview(f"商品「{product.name}」有限購或身分限制，需人工確認")
        delta = quantities[product_id] - old_quantities[product_id]
        if not product.is_unlimited:
            if product.stock_quantity < delta:
                raise AnswerNeedsReview(f"商品「{product.name}」庫存不足")
            product.stock_quantity -= delta
            if product.stock_quantity == 0:
                product.status = ProductStatus.SOLD_OUT
            elif product.status == ProductStatus.SOLD_OUT:
                product.status = ProductStatus.ACTIVE
    category = await session.get(ProductCategory, source.category_id)
    if category is None:
        raise AnswerNeedsReview("來源活動不存在")
    total = sum(item.quantity * item.unit_price for item in items)
    if order is None:
        scope = next(iter(scopes))
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
            notes=f"組織表單預購：{source.name}；交貨時付款",
            items=[],
            applied_promotions=[],
        )
        session.add(order)
    order.buyer_name = name
    order.buyer_office = office
    for item in items:
        item.product = by_id[item.product_id]
    order.items = items
    order.subtotal_price = total
    order.total_price = total
    order.discount_amount = 0
    await session.flush()
    await _apply_order_promotion(session, order, code=None)
    await receivable.sync_shop_order(session, order)
    await queue_preorder_notice(
        session, order, email=email, updated=updating, response_hash=parsed.response_hash
    )
    return order


async def queue_preorder_notice(
    session: AsyncSession, order: Order, *, email: str, updated: bool, response_hash: str
) -> None:
    """成立／更新共用同一份訂單快照；與金額、庫存及帳本同交易提交。"""
    await emit(
        session,
        event_type="shop.order_confirmed",
        payload={
            "order_id": str(order.id),
            "serial_number": order.serial_number,
            "buyer_email": email,
            "buyer_name": order.buyer_name,
            "buyer_office": order.buyer_office,
            "external_preorder": True,
            "order_updated": updated,
            "response_hash": response_hash,
            "payment_method": "cash_on_pickup",
            "subtotal_price": order.subtotal_price,
            "discount_amount": order.discount_amount,
            "total_price": order.total_price,
            "promotions": [
                {"name": row.promotion.name, "discount_amount": row.discount_amount}
                for row in order.applied_promotions
            ],
            "items": [
                {
                    "product_id": str(item.product_id),
                    "product_name": item.product.name,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": item.quantity * item.unit_price,
                    "selected_options": item.selected_options,
                }
                for item in order.items
            ],
        },
    )
    request_processing_after_commit(session)


async def _last_notice(session: AsyncSession, record: ShopSheetRow) -> OutboxEvent | None:
    if len(record.order_ids) != 1:
        return None
    return await session.scalar(
        select(OutboxEvent)
        .where(
            OutboxEvent.event_type == "shop.order_confirmed",
            OutboxEvent.payload["order_id"].as_string() == record.order_ids[0],
        )
        .order_by(OutboxEvent.created_at.desc(), OutboxEvent.id.desc())
        .limit(1)
    )


async def _lock_imported_order(session: AsyncSession, record: ShopSheetRow) -> Order:
    if len(record.order_ids) != 1:
        raise AnswerNeedsReview("匯入帳本無法唯一對應原訂單，請管理者核對")
    order = await session.scalar(
        _order_detail_query()
        .where(Order.id == uuid.UUID(record.order_ids[0]))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if order is None:
        raise AnswerNeedsReview("原訂單已清除；不會重新建立，請聯繫班聯會")
    if order.assistance_scope != "sheet_import" or order.user_id is not None:
        raise AnswerNeedsReview("原訂單不屬於此外部預購來源，請管理者核對")
    return order


def _editable(order: Order) -> bool:
    return (
        order.status in (OrderStatus.PENDING, OrderStatus.CONFIRMED)
        and not order.is_paid
        and not order.is_class_collected
    )


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
    # Google 表單修改回覆時可能改寫時間戳記。只在收集 Email 能唯一對應消失的
    # 舊回覆時延續原帳本；不依姓名猜測，也不把不同收件人套進原訂單。
    missing_by_email: dict[str, list[ShopSheetRow]] = {}
    for previous in missing_imported_by_row.values():
        notice = await _last_notice(session, previous)
        if notice is not None:
            email = str(notice.payload.get("buyer_email", "")).strip().casefold()
            if email:
                missing_by_email.setdefault(email, []).append(previous)
    email_counts = Counter(_cell(row, config.email_column).casefold() for _, row in rows)
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
            email = _cell(row, config.email_column).casefold()
            matches = missing_by_email.get(email, [])
            if identity and identities[identity] == 1 and email_counts[email] == len(matches) == 1:
                record = matches[0]
                record.response_key = key
                missing_by_email.pop(email)
                missing_imported_by_row.pop(record.row_number, None)
            elif previous is not None or matches:
                previous = previous or matches[0]
                previous.status = "changed"
                previous.error = "時間戳記已變更且無法依收集 Email 唯一對應原回覆；請核對原訂單"
                result.review += 1
                continue
        if record is None:
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
        existing = bool(record.order_ids)
        changed = existing and record.content_hash != digest
        try:
            async with session.begin_nested():
                if existing:
                    order = await _lock_imported_order(session, record)
                    parsed = None
                    if changed:
                        parsed = await _parse_response(
                            session,
                            source,
                            config,
                            row,
                            existing_product_ids={item.product_id for item in order.items},
                        )
                        notice = await _last_notice(session, record)
                        if notice is None:
                            raise AnswerNeedsReview("缺少原回覆通知，請管理者核對；不自動覆寫訂單")
                        changed = parsed.response_hash != _previous_response_hash(
                            notice.payload, parsed.products
                        )
                    if changed:
                        if not _editable(order):
                            raise AnswerNeedsReview(
                                "訂單已收款、取消或退款，無法自動修改；敬請聯繫班聯會"
                            )
                        await _build_order(session, source, config, row, order=order, parsed=parsed)
                    elif _editable(order):
                        before = (order.total_price, order.discount_amount)
                        await _apply_order_promotion(session, order, code=None)
                        changed = before != (order.total_price, order.discount_amount)
                        if changed:
                            parsed = parsed or await _parse_response(
                                session,
                                source,
                                config,
                                row,
                                existing_product_ids={item.product_id for item in order.items},
                            )
                            await receivable.sync_shop_order(session, order)
                            await queue_preorder_notice(
                                session,
                                order,
                                email=_cell(row, config.email_column),
                                updated=True,
                                response_hash=parsed.response_hash,
                            )
                else:
                    order = await _build_order(session, source, config, row)
                    record.order_ids = [str(order.id)]
                record.content_hash = digest
                record.status = "imported"
                record.error = None
                await session.flush()
            if not existing:
                result.imported += 1
            elif changed:
                result.updated += 1
            else:
                result.skipped += 1
        except ValueError as exc:
            # rollback 到 savepoint 後重新讀，避免 ORM expired 欄位觸發隱式 I/O。
            record = await session.scalar(
                select(ShopSheetRow).where(
                    ShopSheetRow.source_id == source.id, ShopSheetRow.response_key == key
                )
            )
            assert record is not None
            record.status = "changed" if existing else "review"
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
        if config.public_sheet_id is None:
            values = await read_sheet(source.spreadsheet_id, source.sheet_name, config.max_rows)
        else:
            values = await read_sheet(
                source.spreadsheet_id, source.sheet_name, config.max_rows, config.public_sheet_id
            )
        result = await import_rows(session, source, values)
        source.last_error = None
        source.last_synced_at = datetime.now(UTC)
        return result
    except SheetReadError as exc:
        source.last_error = str(exc)[:500]
        source.last_synced_at = datetime.now(UTC)
        # 保留來源診斷；不把 exception 傳出導致 router rollback 診斷。
        return ShopSheetSyncOut(review=1)
