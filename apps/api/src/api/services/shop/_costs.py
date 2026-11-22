"""商品與選項的目前成本；與下單時售價快照分開計算。"""

import json

from api.models.shop import OrderItem, Product


def option_cost_key(snapshot: dict) -> str:
    if snapshot.get("option_id"):
        return f"id:{snapshot['option_id']}"
    # 舊快照沒有 ID；使用結構化名稱，避免分隔符或不同群組的同名選項互相碰撞。
    return "name:" + json.dumps(
        [str(snapshot.get("group_name", "")), str(snapshot.get("value", ""))],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def selected_cost_options(snapshots: list[dict]) -> dict[str, dict]:
    return {option_cost_key(snapshot): snapshot for snapshot in snapshots}


def option_unit_cost(product: Product, key: str, snapshot: dict) -> int | None:
    costs = product.procurement_option_costs or {}
    # 未加價選項預設不增加成本；加價選項未設定時不可視為零。
    return costs.get(key, None if snapshot.get("price_delta", 0) > 0 else 0)


def item_cost(item: OrderItem) -> tuple[int, int]:
    """回傳已知成本與成本不完整的商品件數（同一件不重複計缺漏）。"""
    costs = [
        item.product.unit_cost,
        *(
            option_unit_cost(item.product, key, snapshot)
            for key, snapshot in selected_cost_options(item.selected_options or []).items()
        ),
    ]
    return (
        item.quantity * sum(cost for cost in costs if cost is not None),
        item.quantity if None in costs else 0,
    )
