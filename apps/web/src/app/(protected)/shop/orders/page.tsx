"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderListItem } from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { useWS } from "@/hooks/useWS";
import { summarizeOrderItems } from "@/lib/shop-order-items";
import { groupActivityPreorders } from "@/lib/shop-preorders";

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [userRoom, setUserRoom] = useState<string | null>(null);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setUserRoom(userId ? `user:${userId}` : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const allOrders: OrderListItem[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await shopApi.listOrders({ limit: "500", offset: String(offset), my_only: "true" });
        allOrders.push(...page);
        if (page.length < 500) break;
      }
      setOrders(allOrders);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "無法載入登記紀錄，請重試。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useWS(userRoom, useCallback((message) => {
    if (message.type === "order.updated") void load();
  }, [load]));

  const activityGroups = groupActivityPreorders(orders);
  const outstanding = activityGroups.reduce((sum, group) => sum + group.outstanding, 0);

  return (
    <div className="shop-orders-page">
      <header className="shop-orders-header">
        <div className="shop-orders-heading">
          <Link href="/shop" className="shop-orders-back" aria-label="返回商品頁">
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <h1>我的預購</h1>
        </div>
      </header>

      {!loading && !loadError && activityGroups.length > 0 && (
        <section className="shop-order-next-step" aria-label="下一步">
          <div>
            <h2>{outstanding > 0 ? `待繳 NT$${outstanding.toLocaleString("zh-TW")}` : "目前沒有待繳款項"}</h2>
            <p>{outstanding > 0
              ? "品項依活動列在下方，班級預購請向班代繳款。已收款後追加的品項，只需補繳差額。"
              : "款項已登記，請依活動通知領取商品。"}</p>
          </div>
          <Link href="/shop" className="shop-order-details">繼續選購 <ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      )}

      <section className="shop-orders-list" aria-labelledby="shop-orders-list-title">
        <h2 id="shop-orders-list-title">預購品項</h2>
        {loading ? (
          <div className="py-3">
            <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
          </div>
        ) : loadError ? (
          <div role="alert" className="shop-orders-error">
            <p>{loadError}</p>
            <button type="button" onClick={() => void load()} className="shop-order-details">重新載入</button>
          </div>
        ) : activityGroups.length === 0 ? (
          <SmartEmptyState
            reason="new"
            subject="預購品項"
            createHref="/shop"
            message="目前沒有預購品項，先到商品頁挑選商品。"
          />
        ) : (
          <div className="shop-order-activity-list">
            {activityGroups.map((group) => (
              <section key={group.key} className="shop-order-activity" aria-label={`${group.label}預購`}>
                <div className="shop-order-activity-heading">
                  <div>
                    <h3>{group.label}</h3>
                  </div>
                  <div className="shop-order-activity-amounts">
                    <strong>合計 NT${group.amount.toLocaleString("zh-TW")}</strong>
                    <span>
                      已繳 NT${group.received.toLocaleString("zh-TW")} · {group.received > 0 && group.outstanding > 0 ? "待補繳" : "待繳"} NT${group.outstanding.toLocaleString("zh-TW")}
                    </span>
                  </div>
                </div>
                <ul className="shop-preorder-items" aria-label={`${group.label}品項`}>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <span>{item.product_name ?? "商品"}</span>
                        {item.selected_options.length > 0 && (
                          <p>{item.selected_options.map((option) => option.value).join("／")}</p>
                        )}
                      </div>
                      <span className="shop-preorder-quantity">× {item.quantity}</span>
                    </li>
                  ))}
                </ul>
                {group.items.length === 0 && <p className="shop-order-row-items">品項資訊請查看登記。</p>}
                <div className="shop-preorder-info">
                  <span>{group.hasClassOrders ? "向班代繳款" : "依活動通知繳款"}</span>
                  {group.orders.length === 1 ? (
                    <Link href={`/shop/orders/${group.orders[0].id}`} className="shop-order-details">
                      登記資訊 <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  ) : (
                    <details className="shop-preorder-records">
                      <summary>登記資訊</summary>
                      {group.orders.map((order) => (
                        <Link key={order.id} href={`/shop/orders/${order.id}`} className="shop-order-details">
                          {summarizeOrderItems(order.items ?? []) || "商品登記"}
                          <time dateTime={order.created_at}>{new Date(order.created_at).toLocaleString("zh-TW")}</time>
                          <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      ))}
                    </details>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
