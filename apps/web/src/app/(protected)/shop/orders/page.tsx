"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
      <span style={{ color: "var(--text-muted)" }}>班聯確認：{order.is_paid ? "已繳費" : "尚未確認"}</span>
    </span>
  );
}

export default function OrdersPage() {
  const { can } = usePermissions();
  const isAdmin = can("shop:manage");

  const [tab, setTab] = useState<"mine" | "all">("mine");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<OrderSummaryOut | null>(null);
  const canManageOrders = isAdmin;
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
      if (canManageOrders) {
        const nextSummary = await shopApi.orderSummary({
          group_by: "class",
        }).catch(() => null);
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

  useEffect(() => { load(); }, [load]);
  useWS(userRoom, useCallback((message) => {
    if (message.type === "order.updated") void load();
  }, [load]));

  useWS(isAdmin ? "shop:orders" : null, useCallback((message) => {
    if (message.type === "order.updated") void load();
  }, [load]), isAdmin);

  const confirmedOrders = orders.filter(o => o.status === "confirmed");
  const activeOrders = orders.filter(o => o.status !== "cancelled" && o.status !== "refunded");
  const paidOrders = activeOrders.filter(o => o.is_paid);
  const unpaidOrders = activeOrders.filter(o => !o.is_paid);
  const collectionDue = activeOrders.filter(o => !o.is_paid && (!o.class_id || !o.is_class_collected));
  const dueAmount = collectionDue.reduce((sum, order) => sum + order.total_price, 0);
  const classCollectedCount = activeOrders.filter(o => o.class_id && o.is_class_collected).length;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* 頁首 */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/shop"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ border: "1px solid var(--border)" }}
            aria-label="返回訂購系統"
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {canManageOrders ? "校商營運工作台" : "我的登記與繳款"}
            </h1>
          </div>
        </div>

        {canManageOrders && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <AnimatedDownloadButton
              className="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:flex-none"
              style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}
              request={() => shopApi.downloadReport("xlsx")}
              filename="orders.xlsx"
              label="匯出 Excel"
              onComplete={() => toast.success("已匯出 XLSX")}
              onError={() => toast.error("匯出失敗")} />
            <AnimatedDownloadButton
              className="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:flex-none"
              style={{ background: "rgba(34,211,238,0.05)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.2)" }}
              request={() => shopApi.downloadReport("csv")}
              filename="orders.csv"
              label="匯出 CSV"
              onComplete={() => toast.success("已匯出 CSV")}
              onError={() => toast.error("匯出失敗")} />
            <Link href="/shop/admin" className="flex-1 rounded-lg px-3 py-2 text-center text-xs font-medium sm:flex-none"
              style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
              商品與統計
            </Link>
          </div>
        )}
      </div>

      {/* 管理員 Tab */}
      {canManageOrders && (
        <div
          className="flex gap-0.5 p-1 rounded-xl w-fit"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
          role="tablist"
          aria-label="訂單範圍">
          {([["mine", "我的登記"], ["all", "全部訂單"]] as const).map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(key);
                }}
                className="px-4 py-1.5 rounded-lg text-xs font-medium transition-[color,background-color,border-color,opacity,box-shadow,transform] disabled:opacity-45"
                style={
                  active
                    ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--primary-dim)" }
                    : { color: "var(--text-muted)", border: "1px solid transparent" }
                }>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* 統計卡片 */}
      {orders.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {(canManageOrders ? [
            { label: "有效訂單", value: activeOrders.length },
            { label: "已確認", value: confirmedOrders.length },
            { label: "已繳訂單", value: paidOrders.length },
            { label: "未繳訂單", value: unpaidOrders.length },
            { label: "未繳金額", value: `NT$${(summary?.unpaid_amount ?? unpaidOrders.reduce((s, o) => s + o.total_price, 0)).toLocaleString()}` },
          ] : [
            { label: "有效登記", value: activeOrders.length },
            { label: "尚待繳交", value: `NT$${dueAmount.toLocaleString()}` },
            { label: "班代已登記", value: `${classCollectedCount} 筆` },
            { label: "班聯已確認", value: `${paidOrders.length} 筆` },
          ]).map(({ label, value }) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
              <p className="text-xl font-bold" style={{ color: "var(--primary)" }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {!canManageOrders && activeOrders.some((order) => order.class_id) && (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          「尚待繳交」依班代的個人收款紀錄計算；班聯會確認整班繳款後，才會顯示正式已繳費。
        </p>
      )}

      {canManageOrders && summary && summary.rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>班級收款排行</h2>
            <Link href="/shop/admin" className="text-xs" style={{ color: "var(--primary)" }}>完整統計</Link>
          </div>
          <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
            {summary.rows.slice(0, 4).map((row) => (
              <div key={row.key} className="px-5 py-4" style={{ borderRight: "1px solid var(--border)" }}>
                <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{row.label}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {row.order_count} 筆 · {row.item_count} 件 · 未繳 NT${row.unpaid_amount.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 訂單列表 */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-4">
            <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
          </div>
        ) : orders.length === 0 ? (
          <SmartEmptyState
            reason="new"
            subject="商品登記"
            createHref="/shop"
            message="還沒登記商品，先到商品頁選擇規格與數量"
          />
        ) : (
          <>
          <div className="divide-y md:hidden" role="list" aria-label="登記列表">
            {orders.map((order) => (
              <div key={order.id} className="space-y-3 px-4 py-4" role="listitem">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/shop/orders/${order.id}`}
                    className="min-w-0 break-all text-xs font-mono hover:underline"
                    style={{ color: "var(--primary)" }}
                  >
                    {order.serial_number}
                  </Link>
                  <OrderStatusBadge status={order.status} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {tab === "all" && (
                    <div className="min-w-0">
                      <dt style={{ color: "var(--text-muted)" }}>用戶</dt>
                      <dd className="mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                        {order.user_name ?? `${order.user_id.slice(0, 8)}…`}
                      </dd>
                    </div>
                  )}
                  <div className="min-w-0">
                    <dt style={{ color: "var(--text-muted)" }}>班級</dt>
                    <dd className="mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {order.class_label ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--text-muted)" }}>繳款進度</dt>
                    <dd className="mt-0.5 font-medium" style={{ color: "var(--text-primary)" }}>
                      <CollectionStatus order={order} />
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--text-muted)" }}>金額</dt>
                    <dd className="mt-0.5 font-medium" style={{ color: "var(--text-primary)" }}>
                      NT${order.total_price.toLocaleString()}
                    </dd>
                  </div>
                </dl>
                <time className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {new Date(order.created_at).toLocaleString("zh-TW")}
                </time>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[700px] text-sm" role="table" aria-label="登記列表">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["登記編號", tab === "all" ? "用戶" : null, "班級", "狀態", "繳款進度", "金額", "登記時間"]
                  .filter(Boolean)
                  .map(h => (
                    <th key={h!} className="px-5 py-3.5 text-left text-xs font-semibold"
                      style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order, idx) => (
                <tr
                  key={order.id}
                  style={idx < orders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td className="px-5 py-4">
                    <Link href={`/shop/orders/${order.id}`}
                      className="text-xs font-mono hover:underline" style={{ color: "var(--primary)" }}>
                      {order.serial_number}
                    </Link>
                  </td>
                  {tab === "all" && (
                    <td className="px-5 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
                      {order.user_name ?? `${order.user_id.slice(0, 8)}…`}
                    </td>
                  )}
                  <td className="px-5 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
                    {order.class_label ?? "—"}
                  </td>
                  <td className="px-5 py-4"><OrderStatusBadge status={order.status} /></td>
                  <td className="px-5 py-4">
                    <span className="text-xs font-medium"><CollectionStatus order={order} /></span>
                  </td>
                  <td className="px-5 py-4 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    NT${order.total_price.toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
                    {new Date(order.created_at).toLocaleString("zh-TW")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
