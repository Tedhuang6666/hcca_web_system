import type { OrderItemOut, OrderListItem } from "@/lib/types";
import { mergeDraftItems } from "./shop-order-items";
import { orderScopeKey } from "./shop-order-scope";

type ActivityPreorder = {
  key: string;
  label: string;
  orders: OrderListItem[];
  items: OrderItemOut[];
  amount: number;
  received: number;
  outstanding: number;
  hasClassOrders: boolean;
};

export function groupActivityPreorders(orders: readonly OrderListItem[]): ActivityPreorder[] {
  const groups = new Map<string, ActivityPreorder>();
  for (const order of orders) {
    if (order.status === "cancelled" || order.status === "refunded") continue;
    const key = orderScopeKey(order);
    const group = groups.get(key) ?? {
      key,
      label: order.activity_name ?? order.category_name
        ?? (order.activity_id ? "已結束的活動" : "一般商品"),
      orders: [], items: [], amount: 0, received: 0, outstanding: 0, hasClassOrders: false,
    };
    group.orders.push(order);
    group.items.push(...(order.items ?? []));
    group.amount += order.total_price;
    group.hasClassOrders ||= Boolean(order.class_id);
    if (order.is_paid || (order.class_id && order.is_class_collected)) {
      group.received += order.total_price;
    } else {
      group.outstanding += order.total_price;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    items: mergeDraftItems(group.items.map((item) => ({
      ...item, option_ids: item.selected_options.map((option) => option.option_id),
    }))).map((item) => ({ ...item, subtotal: item.quantity * item.unit_price })),
  }));
}
