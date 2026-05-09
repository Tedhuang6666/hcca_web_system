"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { shopApi, ApiError } from "@/lib/api";
import type { OrderListItem } from "@/lib/types";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

export default function OrdersPage() {
  const { can } = usePermissions();
  const isAdmin = can("shop:manage");

  const [tab, setTab] = useState<"mine" | "all">("mine");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (tab === "all") params.my_only = "false";
      const data = await shopApi.listOrders(params);
      setOrders(data);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const downloadReport = async (format: "xlsx" | "csv") => {
    setDownloading(true);
    try {
      const res = await shopApi.downloadReport(format);
      if (!res.ok) { toast.error("匯出失敗"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orders.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已匯出 ${format.toUpperCase()}`);
    } catch {
      toast.error("匯出失敗");
    } finally { setDownloading(false); }
  };

  const confirmedOrders = orders.filter(o => o.status === "confirmed");
  const totalAmount = confirmedOrders.reduce((s, o) => s + o.total_price, 0);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* 頁首 */}
      <div className="flex items-center justify-between gap-4">
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
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>訂單記錄</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>查看並管理訂單</p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={() => downloadReport("xlsx")} disabled={downloading}
              className="px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}>
              匯出 Excel
            </button>
            <button onClick={() => downloadReport("csv")} disabled={downloading}
              className="px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              style={{ background: "rgba(34,211,238,0.05)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.2)" }}>
              匯出 CSV
            </button>
          </div>
        )}
      </div>

      {/* 管理員 Tab */}
      {isAdmin && (
        <div
          className="flex gap-0.5 p-1 rounded-xl w-fit"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
          role="tablist"
          aria-label="訂單範圍">
          {([["mine", "我的訂單"], ["all", "全部訂單"]] as const).map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
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
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "總訂單數", value: orders.length },
            { label: "已確認", value: confirmedOrders.length },
            { label: "確認金額", value: `NT$${totalAmount.toLocaleString()}` },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
              <p className="text-xl font-bold" style={{ color: "var(--primary)" }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 訂單列表 */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            <div
              className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
              style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }}
              role="status" aria-label="載入中"
            />
            <p className="text-sm">載入中…</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            <p className="mb-3 text-sm">尚無訂單記錄</p>
            <Link href="/shop" className="text-sm" style={{ color: "var(--primary)" }}>前往選購 →</Link>
          </div>
        ) : (
          <table className="w-full text-sm" role="table" aria-label="訂單列表">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["訂單編號", tab === "all" ? "用戶" : null, "狀態", "金額", "下單時間"]
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
                    <span className="text-xs font-mono" style={{ color: "var(--primary)" }}>
                      {order.serial_number}
                    </span>
                  </td>
                  {tab === "all" && (
                    <td className="px-5 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
                      {order.user_id.slice(0, 8)}…
                    </td>
                  )}
                  <td className="px-5 py-4"><OrderStatusBadge status={order.status} /></td>
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
        )}
      </div>
    </div>
  );
}
