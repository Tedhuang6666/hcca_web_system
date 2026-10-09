// Unlinked catalog categories still represent separate ordering activities.
type OrderScope = { activity_id?: string | null; category_id?: string | null };

export function orderScopeKey(scope: OrderScope): string {
  return scope.activity_id ?? (scope.category_id ? `category:${scope.category_id}` : "none");
}

export function catalogScopeKey(category: { id: string; activity_id?: string | null }): string {
  return orderScopeKey({ activity_id: category.activity_id, category_id: category.id });
}

export function orderScopeParams(key: string): {
  activity_id?: string; category_id?: string; general_only?: string;
} {
  if (key.startsWith("category:")) return { category_id: key.slice(9), general_only: "true" };
  return key === "none" ? { general_only: "true" } : { activity_id: key };
}
