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
  it("班聯統一截止後，單品延長仍不可訂購", () => {
    const extended = { ...category("extended", []), order_closes_at: past,
      series: [{ id: "series", name: "系列", sort_order: 0, products: [{ ...product, sale_end: future, effective_sale_end: future }] }] };
    expect(categoryOrderable(extended, now)).toBe(false);
    expect(defaultShopCategory([extended, category("other", [product])], "extended", now)?.id).toBe("other");
    expect(defaultShopCategory([extended, category("other", [product])], "extended", now, { extended: { is_closed: true } })?.id).toBe("other");
  });
  it("截止當下停止訂購，尚未開售及已結束活動不選為預設", () => {
    expect(productOrderable({ ...product, effective_sale_end: new Date(now).toISOString() }, now)).toBe(false);
    expect(productOrderable({ ...product, sale_start: future }, now)).toBe(false);
    expect(categoryOrderable({ ...category("ended", [product]), activity_status: "ended" }, now)).toBe(false);
  });
  it("手動結單優先於單品延長，收款用目錄仍可判定活動不可訂購", () => {
    const closed = { ...category("closed", [{ ...product, effective_sale_end: future }]), order_closed_at: past };
    expect(categoryOrderable(closed, now)).toBe(false);
    expect(defaultShopCategory([closed, category("other", [product])], "closed", now)?.id).toBe("other");
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
