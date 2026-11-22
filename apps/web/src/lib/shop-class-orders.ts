import type { CatalogCategoryOut, CatalogProductOut } from "@/lib/types";

export type CatalogChoice = CatalogProductOut & {
  activity_id: string | null;
  category: string;
  series: string;
  categoryId: string;
};

export function money(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

export function flattenCatalog(catalog: CatalogCategoryOut[]): CatalogChoice[] {
  return catalog.flatMap((cat) => [
    ...cat.products.map((product) => ({
      ...product, activity_id: cat.activity_id ?? null,
      category: cat.name, series: "單一商品", categoryId: cat.id,
    })),
    ...cat.series.flatMap((series) =>
      series.products.map((product) => ({
        ...product, activity_id: cat.activity_id ?? null,
        category: cat.name, series: series.name, categoryId: cat.id,
      })),
    ),
  ]);
}
