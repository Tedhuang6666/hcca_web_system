import type { CatalogCategoryOut, CatalogProductOut } from "@/lib/types";

const RESERVED_SHOP_SEGMENTS = new Set([
  "admin",
  "cart",
  "class-orders",
  "council-orders",
  "orders",
]);

type ProductEntry = {
  category: CatalogCategoryOut;
  product: CatalogProductOut;
};

function slugify(value: string): string {
  const slug = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-TW")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "product";
}

function shortId(id: string): string {
  return id.replaceAll("-", "").slice(0, 8).toLocaleLowerCase("en");
}

function productsInCategory(category: CatalogCategoryOut): CatalogProductOut[] {
  return [
    ...category.products,
    ...category.series.flatMap((series) => series.products),
  ];
}

function productEntries(catalog: CatalogCategoryOut[]): ProductEntry[] {
  return catalog.flatMap((category) =>
    productsInCategory(category).map((product) => ({ category, product })),
  );
}

function topicSegment(category: CatalogCategoryOut, catalog: CatalogCategoryOut[]): string {
  const base = slugify(category.name);
  const hasCollision = catalog.some((candidate) =>
    candidate.id !== category.id && slugify(candidate.name) === base,
  );
  return hasCollision || RESERVED_SHOP_SEGMENTS.has(base)
    ? `${base}-${shortId(category.id)}`
    : base;
}

function productSegment(product: CatalogProductOut, category: CatalogCategoryOut): string {
  const base = slugify(product.name);
  const hasCollision = productsInCategory(category).some((candidate) =>
    candidate.id !== product.id && slugify(candidate.name) === base,
  );
  return hasCollision ? `${base}-${shortId(product.id)}` : base;
}

function productRouteSegments(
  catalog: CatalogCategoryOut[],
  category: CatalogCategoryOut,
  product: CatalogProductOut,
): string[] {
  const allProducts = productEntries(catalog);
  const categoryProducts = productsInCategory(category);
  const base = slugify(product.name);
  const hasGlobalCollision = allProducts.some((entry) =>
    entry.product.id !== product.id && slugify(entry.product.name) === base,
  );

  if (
    categoryProducts.length === 1
    && !hasGlobalCollision
    && !RESERVED_SHOP_SEGMENTS.has(base)
  ) {
    return [base];
  }

  return [topicSegment(category, catalog), productSegment(product, category)];
}

function encodeSegments(segments: string[]): string {
  return `/shop/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export function shopProductHref(
  catalog: CatalogCategoryOut[],
  category: CatalogCategoryOut,
  product: CatalogProductOut,
): string {
  return encodeSegments(productRouteSegments(catalog, category, product));
}

export function resolveShopProductPath(
  catalog: CatalogCategoryOut[],
  segments: string[],
): ProductEntry | null {
  if (segments.length !== 1 && segments.length !== 2) return null;

  let decodedSegments: string[];
  try {
    decodedSegments = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }

  const entries = productEntries(catalog);
  if (decodedSegments.length === 1) {
    if (RESERVED_SHOP_SEGMENTS.has(decodedSegments[0])) return null;
    const matches = entries.filter(({ product }) => slugify(product.name) === decodedSegments[0]);
    return matches.length === 1 ? matches[0] : null;
  }

  return entries.find(({ category, product }) => {
    const expected = [topicSegment(category, catalog), productSegment(product, category)];
    return expected.every((segment, index) => segment === decodedSegments[index]);
  }) ?? null;
}
