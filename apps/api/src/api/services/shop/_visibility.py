"""未登入的公開商品入口隱藏有購買資格限制的商品。"""

from sqlalchemy import and_, func
from sqlalchemy.sql.elements import ColumnElement

from api.models.shop import Product

_QUALIFICATION_LIST_FIELDS = (
    "allowed_grades",
    "required_permissions",
    "allowed_identifiers",
    "blocked_identifiers",
)


def has_purchase_qualifications(product: Product) -> bool:
    rules = product.purchase_rules or {}
    return bool(rules.get("designated_only")) or any(
        rules.get(field) for field in _QUALIFICATION_LIST_FIELDS
    )


def public_product_condition() -> ColumnElement[bool]:
    """在分頁前過濾；JSON 文字取值同時支援 PostgreSQL 與 SQLite。"""
    return and_(
        func.coalesce(Product.purchase_rules["designated_only"].as_boolean(), False).is_(False),
        *(
            func.coalesce(Product.purchase_rules[field].as_string(), "[]") == "[]"
            for field in _QUALIFICATION_LIST_FIELDS
        ),
    )
