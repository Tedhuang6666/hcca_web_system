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
      <span>議員收款：{order.is_class_collected ? "已收款" : "待收款"}</span>
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
      setOrders(await shopApi.listOrders({ limit: "500", my_only: "true" }));
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

  return (
    <div className="shop-orders-page">
      <header className="shop-orders-header">
        <div className="shop-orders-heading">
          <Link href="/shop" className="shop-orders-back" aria-label="返回商品頁">
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <h1>我的登記</h1>
        </div>
      </header>

      <section className="shop-orders-list" aria-labelledby="shop-orders-list-title">
        <h2 id="shop-orders-list-title">登記紀錄</h2>
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
          <div className="shop-order-list-rows" role="list" aria-label="商品登記列表">
            {orders.map((order) => (
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
                </div>
                <div className="shop-order-row-side">
                  <strong className="shop-order-row-amount">
                    NT${order.total_price.toLocaleString()}
                  </strong>
                  <Link href={`/shop/orders/${order.id}`} className="shop-order-details">
                    登記詳情 <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
