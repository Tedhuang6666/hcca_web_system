import { describe, expect, it } from "vitest";
import type { CatalogCategoryOut, CatalogProductOut } from "@/lib/types";
import { categoryOrderable, deadlineFromInput, deadlineInputValue, defaultShopCategory, productOrderable } from "./shop-deadlines";

const now = Date.parse("2026-10-22T12:00:00Z");
const past = "2026-10-22T11:00:00Z";
const future = "2026-10-23T12:00:00Z";
const product: CatalogProductOut = { id: "p", name: "商品", price: 100, status: "active", stock_quantity: 10, is_unlimited: false, has_variants: false, requires_seating: false };
const category = (id: string, products: CatalogProductOut[]): CatalogCategoryOut => ({ id, name: id, products, series: [], sort_order: 0 });

describe("活動結單與多活動預購", () => {
  it("跳過先前記住的已結單活動，在四個同時存在的活動中選擇可訂購商品", () => {
    const catalog = [category("closed", [{ ...product, effective_sale_end: past }]),
      category("sold", [{ ...product, status: "sold_out" }]), category("open", [product]),
      category("later", [{ ...product, sale_start: future }])];
    expect(defaultShopCategory(catalog, "closed", now)?.id).toBe("open");
    expect(defaultShopCategory(catalog, null, now)?.id).toBe("open");
    expect(defaultShopCategory(catalog, "open", now)?.id).toBe("open");
  });
  it("活動截止後有單品延長時，活動仍可預設顯示；系列商品也計入", () => {
    const extended = { ...category("extended", []), order_closes_at: past,
      series: [{ id: "series", name: "系列", sort_order: 0, products: [{ ...product, sale_end: future, effective_sale_end: future }] }] };
    expect(categoryOrderable(extended, now)).toBe(true);
    expect(defaultShopCategory([extended, category("other", [product])], "extended", now)?.id).toBe("extended");
    expect(defaultShopCategory([extended, category("other", [product])], "extended", now, { extended: { is_closed: true } })?.id).toBe("other");
  });
  it("截止當下停止訂購，尚未開售及已結束活動不選為預設", () => {
    expect(productOrderable({ ...product, effective_sale_end: new Date(now).toISOString() }, now)).toBe(false);
    expect(productOrderable({ ...product, sale_start: future }, now)).toBe(false);
    expect(categoryOrderable({ ...category("ended", [product]), activity_status: "ended" }, now)).toBe(false);
  });
  it("全部結單保留可查看的活動，空目錄安全回傳 null", () => {
    const closed = category("closed", [{ ...product, effective_sale_end: past }]);
    expect(defaultShopCategory([closed], "closed", now)).toBe(closed);
    expect(defaultShopCategory([], null, now)).toBeNull();
  });
  it("以台北時間輸入與儲存，清除時間回傳明確的 null", () => {
    expect(deadlineInputValue("2026-10-22T12:00:00Z")).toBe("2026-10-22T20:00");
    expect(deadlineFromInput("2026-10-22T20:00")).toBe("2026-10-22T12:00:00.000Z");
    expect(deadlineFromInput("")).toBeNull();
  });
});
