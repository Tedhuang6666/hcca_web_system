"use client";

import NumberInput from "@/components/ui/NumberInput";

import { useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderItemOut } from "@/lib/types";

function Source({ item, orderId, canEdit, onChange }: {
  item: OrderItemOut;
  orderId: string;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = item.delegation_link_id
    ? `${item.delegation_name ?? "家人代訂"} · ${item.ordered_by_name ?? "家人"}代訂`
    : `${item.ordered_by_name ?? "本人"}登記`;
  return <li>
    <p>{label}：{item.quantity} 件</p>
    {canEdit && item.delegation_link_id && <form className="shop-delegation-actions" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setMessage("");
      try {
        await shopApi.updateOrderItemQuantity(orderId, item.id, quantity);
        onChange();
      } catch (error) { setMessage(apiErrorMessage(error, "品項更新失敗")); }
      finally { setBusy(false); }
    }}>
      <label>{label}的數量
        <NumberInput type="number" min={0} max={100} required value={quantity} disabled={busy}
          onChange={(event) => setQuantity(Number(event.target.value))} />
      </label>
      <button type="submit" disabled={busy || quantity === item.quantity || !Number.isInteger(quantity)}>
        {busy ? "更新中…" : quantity === 0 ? "移除品項" : "更新數量"}
      </button>
      <span>設為 0 可移除</span>
    </form>}
    {message && <p role="alert">{message}</p>}
  </li>;
}

export default function OrderItemSources({ sources, onChange }: {
  sources: { item: OrderItemOut; orderId: string; canEdit: boolean }[];
  onChange: () => void;
}) {
  return <ul className="shop-order-item-sources" aria-label="登記來源">
    {sources.map((source) => <Source key={`${source.item.id}:${source.item.quantity}`} {...source} onChange={onChange} />)}
  </ul>;
}
