import type { CatalogCategoryOut } from "@/lib/types";

/** 保留已登記商品的調整入口，其餘依後端購買資格過濾。 */
export function eligibleShopCatalog(
  catalog: CatalogCategoryOut[],
  registeredProductIds: ReadonlySet<string> = new Set(),
): CatalogCategoryOut[] {
  return catalog.flatMap((category) => {
    const visible = (product: CatalogCategoryOut["products"][number]) => (
      product.purchase_allowed !== false || registeredProductIds.has(product.id)
    );
    const products = category.products.filter(visible);
    const series = category.series.flatMap((item) => {
      const products = item.products.filter(visible);
      return products.length ? [{ ...item, products }] : [];
    });
    return products.length || series.length ? [{ ...category, products, series }] : [];
  });
}
