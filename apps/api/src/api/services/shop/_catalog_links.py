"""Public direct links into the otherwise open shop catalog."""

from __future__ import annotations

import unicodedata
from collections import defaultdict

from api.schemas.shop import CatalogCategoryOut, CatalogProductOut

_DIRECT_PATH_RESERVED_SEGMENTS = {"admin", "cart", "class-orders", "council-orders", "orders"}


def _direct_path_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().lower()
    parts: list[str] = []
    for char in normalized:
        if char.isalnum():
            parts.append(char)
        elif parts and parts[-1] != "-":
            parts.append("-")
    return "".join(parts).strip("-") or "product"


def _direct_path_short_id(value: str) -> str:
    return value.replace("-", "")[:8].lower()


def filter_catalog_to_direct_product(
    catalog: list[CatalogCategoryOut], segments: list[str]
) -> list[CatalogCategoryOut]:
    """Resolve one public product link while keeping closed items out of catalog listings."""
    if len(segments) not in (1, 2):
        return []

    entries = [
        (category, product)
        for category in catalog
        for product in [
            *category.products,
            *(product for series in category.series for product in series.products),
        ]
    ]
    category_product_ids: defaultdict[str, set[str]] = defaultdict(set)
    product_ids_by_slug: defaultdict[str, set[str]] = defaultdict(set)
    category_product_ids_by_slug: defaultdict[tuple[str, str], set[str]] = defaultdict(set)
    category_ids_by_slug: defaultdict[str, set[str]] = defaultdict(set)
    for category in catalog:
        category_ids_by_slug[_direct_path_slug(category.name)].add(str(category.id))
    for category, product in entries:
        product_slug = _direct_path_slug(product.name)
        category_id = str(category.id)
        product_id = str(product.id)
        category_product_ids[category_id].add(product_id)
        product_ids_by_slug[product_slug].add(product_id)
        category_product_ids_by_slug[(category_id, product_slug)].add(product_id)

    matches: list[tuple[CatalogCategoryOut, CatalogProductOut]] = []
    for category, product in entries:
        product_slug = _direct_path_slug(product.name)
        category_id = str(category.id)
        product_id = str(product.id)
        global_collision = len(product_ids_by_slug[product_slug]) > 1
        product_collision = len(category_product_ids_by_slug[(category_id, product_slug)]) > 1

        category_slug = _direct_path_slug(category.name)
        category_collision = len(category_ids_by_slug[category_slug]) > 1
        topic_segment = (
            f"{category_slug}-{_direct_path_short_id(category_id)}"
            if category_collision or category_slug in _DIRECT_PATH_RESERVED_SEGMENTS
            else category_slug
        )
        product_segment = (
            f"{product_slug}-{_direct_path_short_id(product_id)}"
            if product_collision
            else product_slug
        )
        if (
            len(category_product_ids[category_id]) == 1
            and not global_collision
            and product_slug not in _DIRECT_PATH_RESERVED_SEGMENTS
        ):
            expected_segments = [product_slug]
        else:
            expected_segments = [topic_segment, product_segment]

        if expected_segments == segments:
            matches.append((category, product))

    if len(matches) != 1:
        return []

    category, product = matches[0]
    top_level_products = [item for item in category.products if item.id == product.id]
    series = [
        item.model_copy(update={"products": [nested]})
        for item in category.series
        if (nested := next((nested for nested in item.products if nested.id == product.id), None))
    ]
    return [category.model_copy(update={"products": top_level_products, "series": series})]
