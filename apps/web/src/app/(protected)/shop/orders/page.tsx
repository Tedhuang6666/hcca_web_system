"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderListItem, OrderSummaryOut } from "@/lib/types";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import { useWS } from "@/hooks/useWS";

function CollectionStatus({ order }: { order: OrderListItem }) {
  if (!order.class_id) {
    return <span>{order.is_paid ? "已繳費" : "尚未繳費"}</span>;
  }
  return (
    <span className="grid gap-0.5">
      <span>班代登記：{order.is_class_collected ? "已收款" : "待收款"}</span>
      <span style={{ color: "var(--text-muted)" }}>
        班聯確認：{order.is_paid ? "已繳費" : "尚未確認"}
      </span>
    </span>
  );
}

export default function OrdersPage() {
  const { can } = usePermissions();
  const canManageOrders = can("shop:manage");

  const [tab, setTab] = useState<"mine" | "all">("mine");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<OrderSummaryOut | null>(null);
  const [userRoom, setUserRoom] = useState<string | null>(null);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setUserRoom(userId ? `user:${userId}` : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: "500" };
      if (tab === "all") params.my_only = "false";
      const data = await shopApi.listOrders(params);
      setOrders(data);
      if (canManageOrders && tab === "all") {
        const nextSummary = await shopApi.orderSummary({ group_by: "class" }).catch(() => null);
        setSummary(nextSummary);
      } else {
        setSummary(null);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      setLoading(false);
    }
  }, [canManageOrders, tab]);

  useEffect(() => { void load(); }, [load]);
  useWS(userRoom, useCallback((message) => {
    if (message.type === "order.updated") void load();
  }, [load]));

  useWS(canManageOrders ? "shop:orders" : null, useCallback((message) => {
    if (message.type === "order.updated") void load();
  }, [load]), canManageOrders);

  const confirmedOrders = orders.filter((order) => order.status === "confirmed");
  const activeOrders = orders.filter((order) => order.status !== "cancelled" && order.status !== "refunded");
  const paidOrders = activeOrders.filter((order) => order.is_paid);
  const unpaidOrders = activeOrders.filter((order) => !order.is_paid);
  const stats = canManageOrders && tab === "all" ? [
    { label: "有效訂單", value: activeOrders.length },
    { label: "已確認", value: confirmedOrders.length },
    { label: "已繳訂單", value: paidOrders.length },
    { label: "未繳訂單", value: unpaidOrders.length },
    {
      label: "未繳金額",
      value: `NT$${(summary?.unpaid_amount ?? unpaidOrders.reduce((sum, order) => sum + order.total_price, 0)).toLocaleString()}`,
    },
  ] : [];

  return (
    <div className="shop-orders-page">
      <header className="shop-orders-header">
        <div className="shop-orders-heading">
          <Link href="/shop" className="shop-orders-back" aria-label="返回商品頁">
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <h1>{canManageOrders && tab === "all" ? "全部訂單" : "我的登記"}</h1>
        </div>

        {canManageOrders && tab === "all" && (
          <div className="shop-orders-tools">
            <AnimatedDownloadButton
              className="shop-orders-export"
              request={() => shopApi.downloadReport("xlsx")}
              filename="orders.xlsx"
              label="匯出 Excel"
              onComplete={() => toast.success("已匯出 XLSX")}
              onError={() => toast.error("匯出失敗")} />
            <AnimatedDownloadButton
              className="shop-orders-export"
              request={() => shopApi.downloadReport("csv")}
              filename="orders.csv"
              label="匯出 CSV"
              onComplete={() => toast.success("已匯出 CSV")}
              onError={() => toast.error("匯出失敗")} />
          </div>
        )}
      </header>

      {canManageOrders && (
        <div className="shop-orders-tabs" role="tablist" aria-label="登記範圍">
          {([["mine", "我的登記"], ["all", "全部訂單"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {stats.length > 0 && orders.length > 0 && (
        <div className="shop-orders-stats" aria-label="訂單摘要">
          {stats.map(({ label, value }) => (
            <div key={label} className="shop-orders-stat">
              <p>{label}</p>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}

      {canManageOrders && tab === "all" && summary && summary.rows.length > 0 && (
        <section className="shop-orders-ranking" aria-labelledby="shop-orders-ranking-title">
          <header>
            <h2 id="shop-orders-ranking-title">班級收款排行</h2>
            <Link href="/shop/admin" className="text-xs" style={{ color: "var(--primary-text)" }}>
              完整統計
            </Link>
          </header>
          <div>
            {summary.rows.slice(0, 4).map((row) => (
              <article key={row.key}>
                <strong className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
                  {row.label}
                </strong>
                <p>
                  {row.order_count} 筆 · {row.item_count} 件 · 未繳 NT${row.unpaid_amount.toLocaleString()}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="shop-orders-list" aria-labelledby="shop-orders-list-title">
        <h2 id="shop-orders-list-title">
          {canManageOrders && tab === "all" ? "訂單紀錄" : "登記紀錄"}
        </h2>
        {loading ? (
          <div className="py-3">
            <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
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
                  {tab === "all" && (
                    <p className="shop-order-row-user">
                      登記人：{order.user_name ?? `${order.user_id.slice(0, 8)}…`}
                    </p>
                  )}
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
