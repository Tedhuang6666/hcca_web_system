"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { shopApi, ApiError } from "@/lib/api";
import type { OrderListItem } from "@/lib/types";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    shopApi.listOrders()
      .then(setOrders)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/shop" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200"
            style={{ border: "1px solid var(--border)" }}>←</Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">訂單記錄</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>查看並管理您的所有訂單</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => downloadReport("xlsx")} disabled={downloading}
            className="px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}>
            📊 匯出 Excel
          </button>
          <button onClick={() => downloadReport("csv")} disabled={downloading}
            className="px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: "rgba(34,211,238,0.05)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.2)" }}>
            📄 匯出 CSV
          </button>
        </div>
      </div>

      {/* 統計 */}
      {orders.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "總訂單數", value: orders.length },
            { label: "已付款", value: orders.filter(o => o.status === "paid").length },
            { label: "總金額", value: `NT$${orders.filter(o => o.status === "paid").reduce((s, o) => s + o.total_price, 0).toLocaleString()}` },
          ].map(({ label, value }) => (
            <div key={label} className="glass p-4 text-center">
              <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>{label}</p>
              <p className="text-xl font-bold" style={{ color: "var(--accent)" }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 訂單列表 */}
      <div className="glass overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-500">載入中...</div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <p className="mb-3">尚無訂單記錄</p>
            <Link href="/shop" className="text-sm" style={{ color: "var(--accent)" }}>前往選購 →</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                {["訂單編號", "狀態", "金額", "下單時間"].map(h => (
                  <th key={h} className="px-5 py-3.5 text-xs font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <tr key={order.id} className="border-b hover:bg-white/[0.02] transition-colors"
                  style={{ borderColor: "var(--border)" }}>
                  <td className="px-5 py-4">
                    <span className="text-xs font-mono" style={{ color: "var(--accent)" }}>{order.serial_number}</span>
                  </td>
                  <td className="px-5 py-4"><OrderStatusBadge status={order.status} /></td>
                  <td className="px-5 py-4 text-slate-300 text-sm font-medium">
                    NT${order.total_price.toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-xs" style={{ color: "var(--muted)" }}>
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
