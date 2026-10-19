import { describe, expect, it } from "vitest";

import type { CatalogCategoryOut } from "@/lib/types";
import { resolveShopProductPath, shopProductHref } from "./shop-product-url";

const catalog: CatalogCategoryOut[] = [
  {
    id: "theme-1",
    name: "校慶商品",
    activity_id: null,
    activity_name: null,
    image_url: null,
    sort_order: 0,
    products: [
      {
        id: "bag-1",
        name: "紀念袋",
        image_url: null,
        price: 100,
        status: "active",
        stock_quantity: 10,
        is_unlimited: true,
        sale_start: null,
        sale_end: null,
        has_variants: false,
        requires_seating: false,
        seating_mode: null,
      },
      {
        id: "pin-1",
        name: "紀念徽章",
        image_url: null,
        price: 50,
        status: "active",
        stock_quantity: 10,
        is_unlimited: true,
        sale_start: null,
        sale_end: null,
        has_variants: false,
        requires_seating: false,
        seating_mode: null,
      },
    ],
    series: [],
  },
  {
    id: "theme-2",
    name: "特別活動",
    activity_id: null,
    activity_name: null,
    image_url: null,
    sort_order: 1,
    products: [
      {
        id: "ticket-1",
        name: "入場券",
        image_url: null,
        price: 200,
        status: "active",
        stock_quantity: 10,
        is_unlimited: true,
        sale_start: null,
        sale_end: null,
        has_variants: false,
        requires_seating: false,
        seating_mode: null,
      },
    ],
    series: [],
  },
];

describe("shop product URLs", () => {
  it("uses topic and product segments for a topic with multiple products", () => {
    expect(shopProductHref(catalog, catalog[0], catalog[0].products[0]))
      .toBe("/shop/%E6%A0%A1%E6%85%B6%E5%95%86%E5%93%81/%E7%B4%80%E5%BF%B5%E8%A2%8B");
  });

  it("uses a single product segment when its topic contains one unique product", () => {
    expect(shopProductHref(catalog, catalog[1], catalog[1].products[0]))
      .toBe("/shop/%E5%85%A5%E5%A0%B4%E5%88%B8");
    expect(resolveShopProductPath(catalog, ["入場券"]))
      .toMatchObject({ category: { id: "theme-2" }, product: { id: "ticket-1" } });
    expect(resolveShopProductPath(catalog, ["特別活動", "入場券"]))
      .toMatchObject({ category: { id: "theme-2" }, product: { id: "ticket-1" } });
  });

  it("resolves nested product paths back to their category and product", () => {
    expect(resolveShopProductPath(catalog, ["校慶商品", "紀念袋"]))
      .toMatchObject({ category: { id: "theme-1" }, product: { id: "bag-1" } });
  });

  it("returns null for unknown or ambiguous path shapes", () => {
    expect(resolveShopProductPath(catalog, ["不存在"])).toBeNull();
    expect(resolveShopProductPath(catalog, ["校慶商品", "紀念袋", "其他"])).toBeNull();
  });
});
