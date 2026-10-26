import { afterEach, describe, expect, it, vi } from "vitest";
import { hasShopLookbook, lookbookAssetUrl, lookbookPhotoUrl, productLookbook, shopLookbook } from "./shop-lookbook";

afterEach(() => vi.unstubAllEnvs());

describe("校商照片對照與發布檔案", () => {
  it("辨識這批 DM 款式，其他商品不套用校慶照片", () => {
    expect(productLookbook("104週年校慶棉踢")?.id).toBe("cotton");
    expect(productLookbook("刷毛帽T")?.id).toBe("hoodie");
    expect(productLookbook("校慶風衣外套")?.id).toBe("windbreaker");
    expect(productLookbook("一般風衣外套")).toBeUndefined();
    expect(productLookbook("音樂會票券")).toBeUndefined();
    expect(hasShopLookbook({ name: "其他活動", products: [{ name: "票券" }], series: [] })).toBe(false);
    expect(hasShopLookbook({ name: "校慶", products: [], series: [{ products: [{ name: "棉踢" }] }] })).toBe(true);
    expect(hasShopLookbook({ name: "校慶商品", products: [{ name: "校慶衣服" }], series: [] })).toBe(true);
  });

  it("未設定圖床時使用本機預覽，正式圖片不要求存放於 Git", () => {
    vi.stubEnv("NEXT_PUBLIC_SHOP_LOOKBOOK_BASE_URL", "");
    expect(lookbookPhotoUrl("cotton-01", 480)).toBe("/shop/104/cotton-01-480.webp");
    expect(lookbookAssetUrl("cotton-dm.webp")).toBe("/shop/104/cotton-dm.webp");
  });

  it("全部尺寸、DM 與商品主圖統一使用設定的圖床目錄，正確處理尾斜線", () => {
    const base = "https://images.example.test/images/shop/104";
    vi.stubEnv("NEXT_PUBLIC_SHOP_LOOKBOOK_BASE_URL", ` ${base}/// `);
    for (const collection of shopLookbook) {
      expect(lookbookAssetUrl(`${collection.dm.id}.webp`)).toBe(`${base}/${collection.dm.id}.webp`);
      for (const photo of collection.photos) {
        for (const width of [480, 1440, 2400] as const) {
          expect(lookbookPhotoUrl(photo.id, width)).toBe(`${base}/${photo.id}-${width}.webp`);
        }
      }
    }
  });
});
