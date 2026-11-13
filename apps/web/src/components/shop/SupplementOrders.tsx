"use client";

import { useEffect, useRef, useState } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import { money } from "@/lib/shop-class-orders";
import { orderScopeKey } from "@/lib/shop-order-scope";
import type { OrderListItem, SchoolClassListItem } from "@/lib/types";

const balanceKey = (order: OrderListItem) => `${order.supplement_class_id}:${orderScopeKey(order)}`;
const outstanding = (order: OrderListItem) => order.is_paid ? 0 : Math.max(0, order.total_price - (order.received_amount ?? 0));

export default function SupplementOrders({ canCollect = false, canRejoin = false, refreshKey = 0, classes = [], activityKey, onCollected, onRejoined }: {
  canCollect?: boolean;
  canRejoin?: boolean;
  refreshKey?: number;
  classes?: SchoolClassListItem[];
  activityKey?: string;
  onCollected?: () => void;
  onRejoined?: () => void;
}) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [showPaid, setShowPaid] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const rows: OrderListItem[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await shopApi.listSupplementOrders(offset);
          rows.push(...page);
          if (page.length < 500) break;
        }
        if (active) setOrders(rows);
      } catch (cause) {
        if (active) setLoadError(apiErrorMessage(cause, "無法載入補收款，請重新載入。"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshKey, retry]);

  async function download(order: OrderListItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(order.id);
    setError("");
    setMessage("");
    try {
      const response = order.is_class_balance && order.supplement_class_id
        ? order.activity_id
          ? await shopApi.downloadClassReceipt(order.supplement_class_id, order.activity_id)
          : await shopApi.downloadClassReceipts({ category_id: order.category_id ?? undefined }, [order.supplement_class_id])
        : await shopApi.downloadSupplementReceipt(order.id);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `補收款收據-${order.serial_number}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(apiErrorMessage(cause, "收據下載失敗，請點「下載補收款收據」重試。"));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function act(order: OrderListItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(order.id);
    setError("");
    setMessage("");
    try {
      if (!order.is_paid) {
        if (order.is_class_balance && order.supplement_class_id) {
          const amount = orders.filter((row) => row.is_class_balance && balanceKey(row) === balanceKey(order))
            .reduce((sum, row) => sum + outstanding(row), 0);
          await shopApi.setClassPaid(order.supplement_class_id, true, order.activity_id ?? null,
            order.activity_id ? undefined : order.category_id ?? undefined, { expected_unpaid_amount: amount });
          setRetry((value) => value + 1);
        } else {
          await shopApi.setOrderPaid(order.id, true);
          setOrders((rows) => rows.map((row) => row.id === order.id ? { ...row, is_paid: true, received_amount: row.total_price, class_id: row.supplement_class_id } : row));
        }
        setShowPaid(true);
        setMessage(order.is_class_balance ? "已收齊該班的整班尾款。" : `已確認 ${order.user_name ?? "同學"}的補收款，並歸回原班級。`);
        onCollected?.();
      }
    } catch (cause) {
      setError(apiErrorMessage(cause, "繳費登記失敗，請重試。"));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function rejoin(order: OrderListItem) {
    if (busyRef.current || !window.confirm(`確定將 ${order.serial_number} 併回原班訂單？班代收款紀錄會保留，班聯繳款仍維持未確認。`)) return;
    busyRef.current = true;
    setBusy(order.id);
    setError("");
    setMessage("");
    try {
      await shopApi.rejoinSupplementOrder(order.id);
      setOrders((rows) => rows.filter((row) => row.id !== order.id));
      setMessage(`已將 ${order.serial_number} 併回原班，班代收款紀錄保留，仍待班聯確認繳款。`);
      onRejoined?.();
    } catch (cause) {
      setError(apiErrorMessage(cause, "歸回班級失敗，請重試。"));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const scopedOrders = activityKey ? orders.filter((order) => orderScopeKey(order) === activityKey) : orders;
  const pending = scopedOrders.filter((order) => !order.is_paid);
  const visible = (showPaid ? scopedOrders : pending).filter((order) => !order.is_class_balance);
  const balances = new Map<string, OrderListItem[]>();
  for (const order of scopedOrders.filter((row) => row.is_class_balance)) {
    const key = balanceKey(order);
    balances.set(key, [...(balances.get(key) ?? []), order]);
  }
  const visibleBalances = [...balances].filter(([, rows]) => showPaid || rows.some((order) => !order.is_paid));
  return <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card-bg)" }} aria-labelledby="supplement-orders-title">
    <h2 id="supplement-orders-title" className="font-semibold">追加訂單補收款</h2>
    <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>班級部分繳款的差額列為整班尾款，可在此補齊。個人追加款由訂購同學自行繳款，確認後歸回原班級。下載收據不會登記繳費。</p>
    {loading ? <p role="status" className="mt-3">載入補收款中…</p> : loadError ? <div role="alert" className="mt-3">
      <p>{loadError}</p><button type="button" className="btn btn-ghost min-h-11" onClick={() => setRetry((value) => value + 1)}>重新載入補收款</button>
    </div> : <>
      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        <p>待補收 {money(pending.reduce((sum, order) => sum + outstanding(order), 0))}</p>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showPaid} onChange={(event) => setShowPaid(event.target.checked)} />顯示已收款訂單</label>
      </div>
      {visibleBalances.length > 0 && <ul className="divide-y" aria-label="整班尾款" style={{ borderColor: "var(--border)" }}>
        {visibleBalances.map(([key, rows]) => {
          const order = rows.find((row) => !row.is_paid) ?? rows[0];
          const due = rows.reduce((sum, row) => sum + outstanding(row), 0);
          const label = classes.find((item) => item.id === order.supplement_class_id)?.label ?? order.class_label ?? "原班級";
          return <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div><p className="font-medium">{label} · 整班尾款</p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{order.activity_name ?? order.category_name ?? "一般商品"} · {due > 0 ? `待補收 ${money(due)}` : "已收齊"}</p></div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary min-h-11" disabled={busy !== null} onClick={() => void download(order)}>下載班級收據</button>
              {due > 0 && canCollect && <button type="button" className="btn btn-secondary min-h-11" disabled={busy !== null}
                onClick={() => { if (window.confirm(`確認已收到${label}的尾款 ${money(due)}？`)) void act(order); }}>
                {busy === order.id ? "處理中…" : `收齊尾款 ${money(due)}`}
              </button>}
            </div>
          </li>;
        })}
      </ul>}
      {!visible.length && !visibleBalances.length ? <p className="text-sm" style={{ color: "var(--text-secondary)" }}>目前沒有{showPaid ? "補收款訂單" : "待補收款項"}。</p> : <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {visible.map((order) => <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="break-words font-medium">{order.user_name ?? "同學"} · {order.activity_name ?? order.category_name ?? "一般商品"}</p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {classes.find((item) => item.id === order.supplement_class_id)?.label ?? order.class_label ?? "原班級"} · {order.serial_number} · {money(order.is_paid ? order.total_price : outstanding(order))} · {order.is_paid ? "已收款並歸班" : order.is_class_collected ? "班代已收、待班聯確認繳款" : "待訂購同學自行繳款"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary min-h-11" disabled={busy !== null} onClick={() => void download(order)}>
              {busy === order.id ? "處理中…" : "下載補收款收據"}
            </button>
            {!order.is_paid && canCollect && <button type="button" className="btn btn-secondary min-h-11" disabled={busy !== null} onClick={() => void act(order)}>
              {busy === order.id ? "處理中…" : "登記繳費"}
            </button>}
            {!order.is_paid && canRejoin && <button type="button" className="btn btn-ghost min-h-11" disabled={busy !== null} onClick={() => void rejoin(order)}>
              {busy === order.id ? "處理中…" : "併回班級"}
            </button>}
          </div>
        </li>)}
      </ul>}
    </>}
    {message && <p role="status" className="mt-3">{message}</p>}
    {error && <p role="alert" className="mt-3">{error}</p>}
  </section>;
}
