"use client";

import { useEffect, useRef, useState } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import { money } from "@/lib/shop-class-orders";
import type { OrderListItem, SchoolClassListItem } from "@/lib/types";

export default function SupplementOrders({ canCollect = false, refreshKey = 0, classes = [], onCollected }: {
  canCollect?: boolean;
  refreshKey?: number;
  classes?: SchoolClassListItem[];
  onCollected?: () => void;
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
    const response = await shopApi.downloadSupplementReceipt(order.id);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `補收款收據-${order.serial_number}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function act(order: OrderListItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(order.id);
    setError("");
    setMessage("");
    let collected = order.is_paid;
    try {
      if (!order.is_paid) {
        await shopApi.setOrderPaid(order.id, true);
        collected = true;
        setOrders((rows) => rows.map((row) => row.id === order.id ? { ...row, is_paid: true, class_id: row.supplement_class_id } : row));
        setShowPaid(true);
        setMessage(`已確認 ${order.user_name ?? "同學"}的補收款，並歸回原班級。`);
        onCollected?.();
      }
      await download(order);
    } catch (cause) {
      setError(apiErrorMessage(cause, collected ? "款項已確認；收據下載失敗，請點「下載補收款收據」重試。" : "收款確認失敗，請重試。"));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const pending = orders.filter((order) => !order.is_paid);
  const visible = showPaid ? orders : pending;
  return <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card-bg)" }} aria-labelledby="supplement-orders-title">
    <h2 id="supplement-orders-title" className="font-semibold">追加訂單補收款</h2>
    <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>追加款由該筆訂購同學自行繳款，班代不代墊，暫不列入班級金額。班聯確認收款後，提供本筆收據並自動歸回原班級；結單不影響既有訂單收款。</p>
    {loading ? <p role="status" className="mt-3">載入補收款中…</p> : loadError ? <div role="alert" className="mt-3">
      <p>{loadError}</p><button type="button" className="btn btn-ghost min-h-11" onClick={() => setRetry((value) => value + 1)}>重新載入補收款</button>
    </div> : <>
      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        <p>待補收 {money(pending.reduce((sum, order) => sum + order.total_price, 0))}</p>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showPaid} onChange={(event) => setShowPaid(event.target.checked)} />顯示已收款與收據</label>
      </div>
      {!visible.length ? <p className="text-sm" style={{ color: "var(--text-secondary)" }}>目前沒有{showPaid ? "補收款訂單" : "待補收款項"}。</p> : <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {visible.map((order) => <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="break-words font-medium">{order.user_name ?? "同學"} · {order.activity_name ?? order.category_name ?? "一般商品"}</p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{classes.find((item) => item.id === order.supplement_class_id)?.label ?? order.class_label ?? "原班級"} · {order.serial_number} · {money(order.total_price)} · {order.is_paid ? "已收款並歸班" : "待訂購同學自行繳款"}</p>
          </div>
          {(order.is_paid || canCollect) && <button type="button" className="btn btn-secondary min-h-11" disabled={busy !== null} onClick={() => void act(order)}>
            {busy === order.id ? "處理中…" : order.is_paid ? "下載補收款收據" : "確認收款並下載收據"}
          </button>}
        </li>)}
      </ul>}
    </>}
    {message && <p role="status" className="mt-3">{message}</p>}
    {error && <p role="alert" className="mt-3">{error}</p>}
  </section>;
}
