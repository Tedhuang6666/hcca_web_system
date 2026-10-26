import collections from "./shop-lookbook-data.json";

export const shopLookbook = collections;
export type LookbookCollection = (typeof collections)[number];
export type LookbookPhoto = LookbookCollection["photos"][number];

export function lookbookAssetUrl(filename: string): string {
  const base = process.env.NEXT_PUBLIC_SHOP_LOOKBOOK_BASE_URL?.trim().replace(/\/+$/, "")
    || "/shop/104";
  return `${base}/${filename}`;
}

export function lookbookPhotoUrl(id: string, width: 480 | 1440 | 2400 = 1440): string {
  return lookbookAssetUrl(`${id}-${width}.webp`);
}

/** 僅對照這批 DM 的三款商品，避免把其他活動的上衣或票券套用成校慶服飾。 */
export function productLookbook(name: string): LookbookCollection | undefined {
  const normalized = name.replace(/[\s\-＿_]/g, "").toLowerCase();
  const productName = normalized.replace(/^(?:104(?:th|週年|周年|屆)?(?:校慶)?|校慶)/, "");
  const id = /^(?:棉踢|棉t|棉t恤)$/.test(productName) ? "cotton"
    : /^(?:刷毛帽踢|刷毛帽t)$/.test(productName) ? "hoodie"
      : productName === "風衣外套" ? "windbreaker" : null;
  return collections.find((collection) => collection.id === id);
}

export function hasShopLookbook(category: { name: string; products: { name: string }[];
  series: { products: { name: string }[] }[] }): boolean {
  const products = [...category.products, ...category.series.flatMap((series) => series.products)];
  return products.some((product) => Boolean(productLookbook(product.name)))
    || (/校慶|校商|104/.test(category.name)
      && products.some((product) => /棉|帽|風衣|外套|衣服|服飾|t恤/i.test(product.name)));
}
