import { catalogScopeKey, isOrderingClosed, orderScopeKey } from "@/lib/shop-order-scope";
import type { CatalogChoice } from "@/lib/shop-class-orders";
import type {
  CatalogCategoryOut,
  ClassMemberOut,
  OrderListItem,
  ShopClassSummaryOut,
} from "@/lib/types";

export type CategoryOptionRow = {
  key: string;
  label: string;
  closed: boolean;
  hasUncollectedOrders?: boolean;
};

export function isCollectableOrder(order: Pick<OrderListItem, "status">) {
  return order.status !== "cancelled" && order.status !== "refunded";
}

export function buildCategoryLabels(catalog: CatalogCategoryOut[]) {
  const namesById = new Map<string, Set<string>>();
  for (const category of catalog) {
    const key = catalogScopeKey(category);
    const names = namesById.get(key) ?? new Set<string>();
    names.add(category.name);
    namesById.set(key, names);
  }
  return new Map(Array.from(namesById, ([id, names]) => [id, Array.from(names).join("／")]));
}

export function buildCategoryRows(
  catalog: CatalogCategoryOut[],
  categoryOrders: OrderListItem[],
  categoryLabel: (categoryId: string | null | undefined) => string,
): CategoryOptionRow[] {
  const rows = new Map<string, CategoryOptionRow>();
  for (const category of catalog) {
    const key = catalogScopeKey(category);
    const row = rows.get(key);
    const closed = isOrderingClosed(category);
    rows.set(key, {
      key,
      label: category.name,
      closed: row ? row.closed && closed : closed,
    });
  }
  for (const order of categoryOrders) {
    if (!isCollectableOrder(order)) continue;
    const key = orderScopeKey(order);
    const row = rows.get(key) ?? {
      key,
      label: order.category_name ?? categoryLabel(key),
      closed: true,
    };
    rows.set(key, {
      ...row,
      label: order.category_name ?? row.label,
      hasUncollectedOrders: row.hasUncollectedOrders || (!order.is_class_collected && order.total_price > 0),
    });
  }
  return Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
}

export function resolveActiveLedgerKey(
  categoryRows: CategoryOptionRow[],
  catalogLoading: boolean,
  selectedCategoryKey: string | null,
) {
  if (catalogLoading) return "";
  if (selectedCategoryKey !== null) {
    return categoryRows.some((row) => row.key === selectedCategoryKey) ? selectedCategoryKey : "";
  }
  const open = categoryRows.filter((row) => !row.closed);
  return open.length === 1 ? open[0].key : "";
}

export function buildProductRows(
  activeProducts: CatalogChoice[],
  activeLedgerKey: string,
  categoryFilter: string,
  productSummaryRows: ShopClassSummaryOut["product_rows"],
): ShopClassSummaryOut["product_rows"] {
  const rows = new Map(productSummaryRows.map((row) => [row.product_id, row]));
  for (const product of activeProducts) {
    if (orderScopeKey({ category_id: product.categoryId }) !== activeLedgerKey) continue;
    if (categoryFilter !== "all" && `category:${product.categoryId}` !== categoryFilter) continue;
    if (rows.has(product.id)) continue;
    rows.set(product.id, {
      product_id: product.id,
      product_name: product.name,
      quantity: 0,
      total_amount: 0,
      collected_order_count: 0,
      uncollected_order_count: 0,
      collected_quantity: 0,
      uncollected_quantity: 0,
      collected_amount: 0,
      uncollected_amount: 0,
    });
  }
  return [...rows.values()].sort((a, b) => a.product_name.localeCompare(b.product_name, "zh-Hant"));
}

export function buildProductFilterOptions(
  catalogProducts: CatalogChoice[],
  activeLedgerKey: string,
  categoryFilter: string,
  productRows: ShopClassSummaryOut["product_rows"],
) {
  const byId = new Map<string, string>();
  for (const product of catalogProducts) {
    if (orderScopeKey({ category_id: product.categoryId }) !== activeLedgerKey) continue;
    if (categoryFilter === "all" || `category:${product.categoryId}` === categoryFilter) {
      byId.set(product.id, product.name);
    }
  }
  for (const row of productRows) byId.set(row.product_id, row.product_name);
  return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"));
}

export function buildSeatRows(
  categoryOrders: OrderListItem[],
  activeLedgerKey: string,
  members: ClassMemberOut[],
) {
  const ordersByMember = new Map<string, OrderListItem[]>();
  for (const order of categoryOrders) {
    if (!order.user_id) continue;
    if (orderScopeKey(order) !== activeLedgerKey || !isCollectableOrder(order)) continue;
    const memberOrders = ordersByMember.get(order.user_id) ?? [];
    memberOrders.push(order);
    ordersByMember.set(order.user_id, memberOrders);
  }
  const rows = members.map((member) => {
    const memberOrders = ordersByMember.get(member.id) ?? [];
    ordersByMember.delete(member.id);
    return {
      id: member.id,
      name: member.display_name,
      seat: member.seat_number,
      orders: memberOrders,
      amount: memberOrders.reduce((sum, order) => sum + order.total_price, 0),
      collected: memberOrders.reduce((sum, order) => sum + (order.is_class_collected ? order.total_price : 0), 0),
      councilPaid: memberOrders.reduce((sum, order) => sum + (order.is_paid ? order.total_price : 0), 0),
    };
  });
  for (const [id, memberOrders] of ordersByMember) {
    rows.push({
      id,
      name: memberOrders[0].user_name ?? "未列入名冊的訂購人",
      seat: null,
      orders: memberOrders,
      amount: memberOrders.reduce((sum, order) => sum + order.total_price, 0),
      collected: memberOrders.reduce((sum, order) => sum + (order.is_class_collected ? order.total_price : 0), 0),
      councilPaid: memberOrders.reduce((sum, order) => sum + (order.is_paid ? order.total_price : 0), 0),
    });
  }
  return rows.sort((a, b) => (a.seat ?? Number.POSITIVE_INFINITY) - (b.seat ?? Number.POSITIVE_INFINITY)
    || a.name.localeCompare(b.name, "zh-Hant"));
}
