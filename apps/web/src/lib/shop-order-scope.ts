type OrderScope = { category_id?: string | null };

export function isOrderingClosed(scope: { order_closed_at?: string | null }): boolean {
  return Boolean(scope.order_closed_at);
}

export function orderScopeKey(scope: OrderScope): string {
  return scope.category_id ? `category:${scope.category_id}` : "none";
}

export function catalogScopeKey(category: { id: string }): string {
  return orderScopeKey({ category_id: category.id });
}

export function orderScopeParams(key: string): {
  category_id?: string; general_only?: string;
} {
  if (key.startsWith("category:")) return { category_id: key.slice(9) };
  return key === "none" ? { general_only: "true" } : {};
}
