"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CheckSquare, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderListItem } from "@/lib/types";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";

type PaidFilter = "all" | "paid" | "unpaid";

export default function ClassOrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    const params =
      paidFilter === "all" ? undefined : { is_paid: paidFilter === "paid" ? "true" : "false" };
    shopApi
      .listClassOrders(params)
      .then((items) => {
        setOrders(items);
        setSelectedIds((current) => current.filter((id) => items.some((item) => item.id === id)));
      })
      .catch((e) => toast.error(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, [paidFilter]);

  useEffect(load, [load]);

  const togglePaid = async (order: OrderListItem) => {
    setBusy(order.id);
    try {
      const updated = await shopApi.setOrderPaid(order.id, !order.is_paid);
      setOrders((prev) => {
        const next = prev.map((o) => (o.id === order.id ? { ...o, is_paid: updated.is_paid } : o));
        if (paidFilter === "all") return next;
        return next.filter((o) => (paidFilter === "paid" ? o.is_paid : !o.is_paid));
      });
      setSelectedIds((current) => current.filter((id) => id !== order.id));
      toast.success(updated.is_paid ? "已標示為已繳費" : "已取消繳費標示");
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    } finally {
      setBusy(null);
    }
  };

  const active = orders.filter((o) => o.status !== "cancelled");
  const paidCount = active.filter((o) => o.is_paid).length;
  const totalAmount = active.reduce((s, o) => s + o.total_price, 0);
  const paidAmount = active.filter((o) => o.is_paid).reduce((s, o) => s + o.total_price, 0);
  const selectedSet = new Set(selectedIds);
  const selectedOrders = orders.filter((order) => selectedSet.has(order.id));
  const allVisibleSelected = orders.length > 0 && orders.every((order) => selectedSet.has(order.id));

  const toggleSelected = (orderId: string) => {
    setSelectedIds((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(orders.map((order) => order.id));
  };

  const batchSetPaid = async (isPaid: boolean) => {
    const targets = selectedOrders.filter((order) => order.is_paid !== isPaid);
    if (targets.length === 0) {
      toast.info(isPaid ? "選取訂單都已標示為已繳費" : "選取訂單都已是未繳費");
      return;
    }
    setBatchBusy(true);
    try {
      const updated = await Promise.all(
        targets.map((order) => shopApi.setOrderPaid(order.id, isPaid)),
      );
      const updatedById = new Map(updated.map((order) => [order.id, order.is_paid]));
      setOrders((prev) => {
        const next = prev.map((order) =>
          updatedById.has(order.id)
            ? { ...order, is_paid: updatedById.get(order.id) ?? false }
            : order,
        );
        if (paidFilter === "all") return next;
        return next.filter((order) => (paidFilter === "paid" ? order.is_paid : !order.is_paid));
      });
      setSelectedIds([]);
      toast.success(isPaid ? `已標示 ${targets.length} 筆為已繳費` : `已取消 ${targets.length} 筆繳費標示`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "批量更新失敗"));
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            班級訂單結單
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            檢視本班訂購情形，收費後標示為已繳費
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="btn btn-ghost" aria-label="重新整理">
            <RefreshCw size={15} /> 重新整理
          </button>
          <Link href="/shop" className="btn btn-ghost">校商訂購</Link>
        </div>
      </div>

      {!loading && active.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "訂單數", value: String(active.length) },
            { label: "已收費", value: `${paidCount}/${active.length}` },
            { label: "應收金額", value: `NT$${totalAmount.toLocaleString()}` },
            { label: "已收金額", value: `NT$${paidAmount.toLocaleString()}` },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
              <p className="text-lg font-bold" style={{ color: "var(--primary)" }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "unpaid", "paid"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPaidFilter(key)}
                className="rounded-md px-3 py-1.5 text-xs font-medium"
                style={paidFilter === key
                  ? { background: "var(--primary-dim)", color: "var(--primary)" }
                  : { border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                {key === "all" ? "全部" : key === "unpaid" ? "未繳費" : "已繳費"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAllVisible}
              disabled={orders.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {allVisibleSelected ? "取消選取" : "全選"}
            </button>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              已選 {selectedIds.length} 筆
            </span>
            <button
              type="button"
              disabled={selectedIds.length === 0 || batchBusy}
              onClick={() => batchSetPaid(true)}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ border: "1px solid var(--border)", color: "#16a34a" }}>
              批量已繳
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0 || batchBusy}
              onClick={() => batchSetPaid(false)}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              批量未繳
            </button>
          </div>
        </div>
        {loading ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            <p className="text-sm">載入中…</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            <p className="text-sm">目前沒有可檢視的班級訂單</p>
            <p className="text-xs mt-1">僅班級幹部可在此檢視所屬班級的訂購情形</p>
          </div>
        ) : (
          <table className="w-full text-sm" role="table" aria-label="班級訂單">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["", "訂單編號", "訂購人", "班級", "狀態", "金額", "繳費", ""].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-semibold"
                    style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order, idx) => (
                <tr key={order.id}
                  style={idx < orders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => toggleSelected(order.id)}
                      aria-label={selectedSet.has(order.id) ? "取消選取訂單" : "選取訂單"}
                      style={{ color: selectedSet.has(order.id) ? "var(--primary)" : "var(--text-muted)" }}>
                      {selectedSet.has(order.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs font-mono" style={{ color: "var(--primary)" }}>
                      {order.serial_number}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {order.user_name ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {order.class_label ?? "—"}
                  </td>
                  <td className="px-4 py-3.5"><OrderStatusBadge status={order.status} /></td>
                  <td className="px-4 py-3.5 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    NT${order.total_price.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={order.is_paid
                        ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                        : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                      {order.is_paid ? "已繳費" : "未繳費"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() => togglePaid(order)}
                      disabled={busy === order.id}
                      className="btn btn-ghost text-xs px-3 py-1.5"
                      aria-busy={busy === order.id}>
                      {order.is_paid ? "取消繳費" : "標示已繳費"}
                    </button>
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
