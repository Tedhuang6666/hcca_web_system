"use client";

import { useRef, useState } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { OrderListItem } from "@/lib/types";

export default function SeparateOrderButton({ order, onSeparated }: { order: OrderListItem; onSeparated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  if (!order.class_id || order.is_paid || order.status === "cancelled" || order.status === "refunded") return null;
  return <div>
    <button type="button" className="btn btn-ghost min-h-11 text-xs" disabled={busy} aria-label={`將${order.user_name ?? "此筆"}訂單獨立收款`} onClick={async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true); setError("");
      try { await shopApi.separateOrder(order.id); onSeparated(); }
      catch (cause) { setError(apiErrorMessage(cause, "無法獨立收款，請重試。")); }
      finally { setBusy(false); busyRef.current = false; }
    }}>{busy ? "分出中…" : "獨立收款"}</button>
    {error && <p role="alert" className="text-xs">{error}</p>}
  </div>;
}
