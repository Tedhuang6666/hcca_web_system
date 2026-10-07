"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderListItem } from "@/lib/types";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { useWS } from "@/hooks/useWS";

function CollectionStatus({ order }: { order: OrderListItem }) {
  if (!order.class_id) {
    return <span>{order.is_paid ? "已繳費" : "尚未繳費"}</span>;
  }
  return (
    <span className="grid gap-0.5">
      <span>班代收款：{order.is_class_collected ? "已收款" : "待收款"}</span>
      <span style={{ color: "var(--text-muted)" }}>
        班聯確認：{order.is_paid ? "已繳費" : "尚未確認"}
      </span>
    </span>
  );
}

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

  const activityGroups = new Map<string, {
    label: string;
    orders: OrderListItem[];
    amount: number;
    classCollected: number;
    councilPaid: number;
    hasClassOrders: boolean;
  }>();
  for (const order of orders) {
    const key = order.activity_id ?? "general";
    const group = activityGroups.get(key) ?? {
      label: order.activity_name ?? (order.activity_id ? "已結束的活動" : "一般商品"),
      orders: [],
      amount: 0,
      classCollected: 0,
      councilPaid: 0,
      hasClassOrders: false,
    };
    group.orders.push(order);
    if (order.class_id) group.hasClassOrders = true;
    if (order.status !== "cancelled" && order.status !== "refunded") {
      group.amount += order.total_price;
      if (order.is_class_collected) group.classCollected += order.total_price;
      if (order.is_paid) group.councilPaid += order.total_price;
    }
    activityGroups.set(key, group);
  }

  return (
    <div className="shop-orders-page">
      <header className="shop-orders-header">
        <div className="shop-orders-heading">
          <Link href="/shop" className="shop-orders-back" aria-label="返回商品頁">
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <h1>我的訂單</h1>
        </div>
      </header>

      <section className="shop-orders-list" aria-labelledby="shop-orders-list-title">
        <h2 id="shop-orders-list-title">依活動查看訂單</h2>
        {loading ? (
          <div className="py-3">
            <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
          </div>
        ) : loadError ? (
          <div role="alert" className="shop-orders-error">
            <p>{loadError}</p>
            <button type="button" onClick={() => void load()} className="shop-order-details">重新載入</button>
          </div>
        ) : orders.length === 0 ? (
          <SmartEmptyState
            reason="new"
            subject="商品登記"
            createHref="/shop"
            message="還沒有商品登記，先到商品頁挑選商品。"
          />
        ) : (
          <div className="shop-order-activity-list">
            {[...activityGroups.entries()].map(([activityKey, group]) => (
              <section key={activityKey} className="shop-order-activity" aria-label={`${group.label}訂單`}>
                <div className="shop-order-activity-heading">
                  <div>
                    <h3>{group.label}</h3>
                    <p>{group.orders.length} 筆訂單 · 應繳金額不含取消及退款訂單</p>
                  </div>
                  <div className="shop-order-activity-amounts">
                    <strong>訂單總額 NT${group.amount.toLocaleString("zh-TW")}</strong>
                    {group.hasClassOrders ? (
                      <span>班代已收 NT${group.classCollected.toLocaleString("zh-TW")} · 班聯已確認 NT${group.councilPaid.toLocaleString("zh-TW")}</span>
                    ) : (
                      <span>已繳費 NT${group.councilPaid.toLocaleString("zh-TW")}</span>
                    )}
                  </div>
                </div>
                <div className="shop-order-list-rows" role="list" aria-label={`${group.label}訂單列表`}>
                  {group.orders.map((order) => (
                    <article key={order.id} className="shop-order-row" role="listitem">
                      <div>
                        <div className="shop-order-row-main">
                          <div>
                            <p className="shop-order-row-code">{order.serial_number}</p>
                            <p className="shop-order-row-meta">
                              <time dateTime={order.created_at}>
                                {new Date(order.created_at).toLocaleString("zh-TW")}
                              </time>
                              {order.class_label && <span>{order.class_label}</span>}
                            </p>
                          </div>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <div className="shop-order-row-collection">
                          <CollectionStatus order={order} />
                        </div>
                        <p className="shop-order-row-items">
                          {order.items?.length
                            ? order.items.map((item) => `${item.product_name ?? "商品"} × ${item.quantity}`).join("、")
                            : "商品明細請查看訂單"}
                        </p>
                      </div>
                      <div className="shop-order-row-side">
                        <strong className="shop-order-row-amount">
                          NT${order.total_price.toLocaleString()}
                        </strong>
                        <Link href={`/shop/orders/${order.id}`} className="shop-order-details">
                          查看訂單 <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
