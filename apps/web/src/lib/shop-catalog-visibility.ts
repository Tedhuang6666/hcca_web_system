import type { CatalogCategoryOut } from "@/lib/types";

/** 使用後端依購買者計算的資格，移除不可購買票種與空的目錄分組。 */
export function eligibleShopCatalog(catalog: CatalogCategoryOut[]): CatalogCategoryOut[] {
  return catalog.flatMap((category) => {
    const products = category.products.filter((product) => product.purchase_allowed !== false);
    const series = category.series.flatMap((item) => {
      const products = item.products.filter((product) => product.purchase_allowed !== false);
      return products.length ? [{ ...item, products }] : [];
    });
    return products.length || series.length ? [{ ...category, products, series }] : [];
  });
}
