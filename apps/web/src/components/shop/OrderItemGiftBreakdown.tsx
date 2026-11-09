import type { OrderItemOut } from "@/lib/types";
import { orderItemDisplayRows } from "@/lib/shop-order-items";

export default function OrderItemGiftBreakdown({ items }: { items: readonly OrderItemOut[] }) {
  if (!items.some((item) => (item.gift_quantity ?? 0) > 0)) return null;
  return <ul aria-label="購買與贈品明細">
    {orderItemDisplayRows(items).map((row) => <li key={row.display_id}>
      {row.is_gift ? "贈品" : "購買"} {row.quantity} 件 · NT${row.subtotal.toLocaleString("zh-TW")}
      {row.is_gift && row.subtotal > 0 && "（規格加價）"}
    </li>)}
  </ul>;
}
