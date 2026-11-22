"use client";

import NumberInput from "@/components/ui/NumberInput";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderItemOut, ProductOut } from "@/lib/types";

function Source({ item, orderId, canEdit, onChange }: {
  item: OrderItemOut;
  orderId: string;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [product, setProduct] = useState<ProductOut | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const originalOptions = item.selected_options.map((option) => option.option_id).sort().join(",");
  const optionIds = Object.values(picked).sort();
  const optionsChanged = editing && optionIds.join(",") !== originalOptions;
  const label = item.delegation_link_id
    ? `${item.delegation_name ?? "家人代訂"} · ${item.ordered_by_name ?? "家人"}代訂`
    : `${item.ordered_by_name ?? "本人"}登記`;
  return <li>
    <p>{label}：{item.quantity} 件</p>
    {canEdit && <form className="shop-order-item-form" onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setMessage("");
      try {
        if (editing) await shopApi.updateOrderItem(orderId, item.id, { quantity, option_ids: optionIds });
        else await shopApi.updateOrderItemQuantity(orderId, item.id, quantity);
        setEditing(false);
        toast.success(quantity === 0 ? "已移除這項登記。" : "已儲存尺寸／規格與數量。");
        onChange();
      } catch (error) {
        setMessage(apiErrorMessage(error, "品項更新失敗，請重試。"));
        requestAnimationFrame(() => errorRef.current?.focus());
      }
      finally { setBusy(false); }
    }}>
      {editing && product && <fieldset disabled={busy || quantity === 0} className="shop-order-variant-fields">
        <legend>修改尺寸／規格</legend>
        {product.variant_groups.map((group, index) => <label key={group.id}>{group.name}
          <select autoFocus={index === 0} required value={picked[group.id] ?? ""}
            onChange={(event) => setPicked((current) => ({ ...current, [group.id]: event.target.value }))}>
            <option value="" disabled>請選擇{group.name}</option>
            {group.options.filter((option) => option.is_active).map((option) => <option key={option.id} value={option.id}>
              {option.value}{option.price_delta ? `（加價 NT$${option.price_delta.toLocaleString()}）` : ""}
            </option>)}
          </select>
        </label>)}
        {product.variant_groups.length === 0 && <p>此商品沒有可選規格，可直接修改數量。</p>}
        {quantity > 0 && <p>商品小計 NT${((product.price + product.variant_groups.reduce((sum, group) =>
          sum + (group.options.find((option) => option.id === picked[group.id])?.price_delta ?? 0), 0)) * quantity).toLocaleString()}，優惠於儲存後重新計算。</p>}
      </fieldset>}
      <label>{label}的數量
        <NumberInput type="number" min={0} max={100} required value={quantity} disabled={busy}
          onChange={(event) => setQuantity(Number(event.target.value))} />
      </label>
      <div className="shop-delegation-actions">
        <button type="submit" disabled={busy || (quantity === item.quantity && !optionsChanged) || !Number.isInteger(quantity)}>
          {busy ? "更新中…" : quantity === 0 ? "移除品項" : editing ? "儲存修改" : "更新數量"}
        </button>
        {editing ? <button type="button" disabled={busy} onClick={() => {
          setEditing(false); setQuantity(item.quantity); setMessage("");
          requestAnimationFrame(() => trigger.current?.focus());
        }}>取消修改</button> : <button ref={trigger} type="button" disabled={busy} onClick={async () => {
          setBusy(true); setMessage("");
          try {
            const detail = await shopApi.getProduct(item.product_id);
            setProduct(detail);
            setPicked(Object.fromEntries(detail.variant_groups.map((group) => [group.id,
              item.selected_options.find((option) => option.group_id === group.id
                && group.options.some((current) => current.id === option.option_id && current.is_active))?.option_id ?? ""])));
            setEditing(true);
          } catch (error) {
            setMessage(apiErrorMessage(error, "無法載入尺寸／規格，請重試。"));
            requestAnimationFrame(() => errorRef.current?.focus());
          }
          finally { setBusy(false); }
        }}>修改尺寸／規格</button>}
      </div>
      <span>設為 0 可移除</span>
    </form>}
    {message && <p ref={errorRef} tabIndex={-1} role="alert">{message}</p>}
  </li>;
}

export default function OrderItemSources({ sources, onChange }: {
  sources: { item: OrderItemOut; orderId: string; canEdit: boolean }[];
  onChange: () => void;
}) {
  return <ul className="shop-order-item-sources" aria-label="登記來源">
    {sources.map((source) => <Source key={`${source.item.id}:${source.item.quantity}:${source.item.selected_options.map((option) => option.option_id).join(",")}`} {...source} onChange={onChange} />)}
  </ul>;
}
