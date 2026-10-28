"""可追溯至統計明細的描述性摘要，不推測因果或未來銷量。"""

from api.schemas.shop_analytics import ShopSalesInsight, ShopSalesPeriod


def build_sales_insights(
    current: ShopSalesPeriod, previous: ShopSalesPeriod | None
) -> list[ShopSalesInsight]:
    insights: list[ShopSalesInsight] = []
    metrics = current.metrics
    if not metrics.order_count:
        return [
            ShopSalesInsight(
                title="本期沒有有效訂單",
                detail="請調整活動、品項或日期；取消與退款仍可在訂單狀態分析中查看。",
            )
        ]
    peak = max(current.daily, key=lambda row: row.total_amount)
    insights.append(
        ShopSalesInsight(
            title="訂購金額高峰",
            detail=f"{peak.key} 的訂購金額 NT${peak.total_amount:,}，共 {peak.order_count:,} 筆、{peak.item_count:,} 件，占本期金額 {peak.total_amount / metrics.total_amount * 100 if metrics.total_amount else 0:.1f}%。",
        )
    )
    top = sorted(current.products, key=lambda row: row.total_amount, reverse=True)
    if top:
        share = (
            sum(row.total_amount for row in top[:3]) / metrics.total_amount * 100
            if metrics.total_amount
            else 0
        )
        insights.append(
            ShopSalesInsight(
                title="商品集中度",
                detail=f"前三項商品占訂購金額 {share:.1f}%；最高為「{top[0].label}」NT${top[0].total_amount:,}、{top[0].item_count:,} 件。",
            )
        )
    unpaid = max(current.classes, key=lambda row: row.total_amount - row.paid_amount, default=None)
    if unpaid and unpaid.total_amount > unpaid.paid_amount:
        amount = unpaid.total_amount - unpaid.paid_amount
        insights.append(
            ShopSalesInsight(
                title="待核對款項",
                detail=f"「{unpaid.label}」班聯未確認 NT${amount:,}，占本期未確認金額 {amount / metrics.unpaid_amount * 100:.1f}%。此數字包含已交班代、尚未由班聯確認的款項。",
            )
        )
    if previous:
        old = previous.metrics.total_amount
        change = metrics.total_amount - old
        detail = f"本期較比較期{'增加' if change >= 0 else '減少'} NT${abs(change):,}"
        detail += f"（{change / old * 100:+.1f}%）。" if old else "；比較期為零，無法計算成長率。"
        insights.append(
            ShopSalesInsight(
                title="期間金額變化", detail=detail + "兩期使用相同篩選；差異不代表促銷造成的成效。"
            )
        )
    insights.append(
        ShopSalesInsight(
            title="訂購人數與深度",
            detail=f"{metrics.buyer_count:,} 位訂購人平均 NT${metrics.average_buyer_amount:,.2f}；其中 {metrics.repeat_buyer_count:,} 人在所選範圍有兩筆以上訂單（{metrics.repeat_buyer_rate:.1f}%）。追加原訂單不會增加訂單筆數。",
        )
    )
    return insights
