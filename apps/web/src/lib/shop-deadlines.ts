import type { CatalogCategoryOut, CatalogProductOut } from "@/lib/types";

type ProductDeadline = { sale_end?: string | null; effective_sale_end?: string | null };

export function productDeadline(product: ProductDeadline): string | null {
  return product.effective_sale_end ?? product.sale_end ?? null;
}

export function productOrderable(product: CatalogProductOut, now: number): boolean {
  const deadline = productDeadline(product);
  return product.status === "active"
    && (product.is_unlimited || product.stock_quantity > 0)
    && (!product.sale_start || new Date(product.sale_start).getTime() <= now)
    && (!deadline || new Date(deadline).getTime() > now);
}

export function categoryOrderable(
  category: CatalogCategoryOut, now: number, classClosed = false,
): boolean {
  return !classClosed && category.activity_status !== "ended" && category.activity_status !== "archived"
    && [...category.products, ...category.series.flatMap((series) => series.products)]
      .some((product) => productOrderable(product, now));
}

export function defaultShopCategory(
  catalog: CatalogCategoryOut[], preferredId: string | null, now: number,
  closes: Record<string, { is_closed?: boolean }> = {},
): CatalogCategoryOut | null {
  const preferred = catalog.find((category) => category.id === preferredId);
  const open = (category: CatalogCategoryOut) => categoryOrderable(category, now, closes[category.id]?.is_closed);
  return (preferred && open(preferred) ? preferred : catalog.find(open)) ?? preferred ?? catalog[0] ?? null;
}

export function deadlineInputValue(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso)).replace(" ", "T");
}

export function deadlineFromInput(value: string): string | null {
  return value ? new Date(`${value}+08:00`).toISOString() : null;
}
