"use client";

import { useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderListItem } from "@/lib/types";

export function useOrderRecalc() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const run = async (onDone: () => Promise<void>) => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const data = await shopApi.recalculateOrderPromotions([...selected]);
      const skipped = data.results.filter((row) => row.status === "skipped");
      setResult(`重算完成：${data.updated} 筆已更新、${data.unchanged} 筆無變動`
        + (skipped.length ? `、${skipped.length} 筆略過（${skipped.map((row) => `${row.serial_number || "不存在"}：${row.reason}`).join("；")}）` : "。"));
      setSelected(new Set());
      await onDone();
    } catch (e) {
      setError(apiErrorMessage(e, "重算失敗，請稍後再試。"));
    } finally {
      setBusy(false);
    }
  };

  return { selected, setSelected, busy, result, error, run };
}

type Recalc = ReturnType<typeof useOrderRecalc>;

export function OrderRecalcBar({ recalc, disabled, onDone }: { recalc: Recalc; disabled: boolean; onDone: () => Promise<void> }) {
  return (
    <>
      {recalc.result && <p role="status" className="mb-3 text-sm">{recalc.result}</p>}
      {recalc.error && <p role="alert" className="mb-3 text-sm text-red-600">{recalc.error}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ghost min-h-11 whitespace-nowrap"
          disabled={disabled || recalc.busy || recalc.selected.size === 0}
          onClick={() => void recalc.run(onDone)}>
          {recalc.busy ? "重算中…" : `重算所選訂單優惠（${recalc.selected.size}）`}
        </button>
      </div>
    </>
  );
}

export function OrderRecalcSelectAll({ recalc, orderIds }: { recalc: Recalc; orderIds: string[] }) {
  return (
    <th scope="col" className="px-4 py-3 text-left">
      <input type="checkbox" className="h-5 w-5" aria-label="選取目前列表全部訂單"
        checked={orderIds.length > 0 && orderIds.every((id) => recalc.selected.has(id))}
        onChange={(event) => recalc.setSelected(event.target.checked ? new Set(orderIds) : new Set())} />
    </th>
  );
}

export function OrderRecalcCheckbox({ recalc, order }: { recalc: Recalc; order: OrderListItem }) {
  return (
    <td data-label="選取" className="px-4 py-3">
      <input type="checkbox" className="h-5 w-5" aria-label={`選取訂單 ${order.serial_number}`}
        checked={recalc.selected.has(order.id)}
        onChange={(event) => recalc.setSelected((current) => {
          const next = new Set(current);
          if (event.target.checked) next.add(order.id); else next.delete(order.id);
          return next;
        })} />
    </td>
  );
}
