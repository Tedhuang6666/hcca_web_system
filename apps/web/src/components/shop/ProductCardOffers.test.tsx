import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogProductOut, ShopPromotionPublicOut } from "@/lib/types";
import ProductCardOffers from "./ProductCardOffers";

const product: CatalogProductOut = {
  id: "shirt", name: "衣服", price: 300, status: "active", image_url: null,
  stock_quantity: 50, is_unlimited: true, has_variants: true, requires_seating: false,
  seating_mode: null, sale_start: null, sale_end: null,
};
const pants = { ...product, id: "pants", name: "褲子", price: 500 };
const promotion: ShopPromotionPublicOut = {
  id: "bundle", name: "衣褲套組", activity_id: null, code: null,
  discount_type: "bundle_price", discount_value: 650, min_order_price: 0, min_quantity: 1,
  target_products: [{ id: "shirt", name: "衣服" }, { id: "pants", name: "褲子" }],
};

describe("商品卡片內的優惠", () => {
  it("套組只保留簡短選購入口，不重複完整價格與條件", () => {
    const select = vi.fn();
    const { container } = render(<ProductCardOffers product={product} promotions={[promotion]}
      products={new Map([[product.id, product], [pants.id, pants]])} disabled={false} onSelectBundle={select} />);
    expect(screen.queryByText("衣褲套組")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/每套省|每項各一件|NT\$/);
    expect(container.querySelector("del")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "選購套組：衣褲套組" }));
    expect(select).toHaveBeenCalledWith(promotion);
  });

  it("條件式優惠在卡片上寫出件數、金額與優惠碼", () => {
    render(<ProductCardOffers product={product} promotions={[{
      ...promotion, discount_type: "percentage", discount_value: 10, min_quantity: 2,
      min_order_price: 1000, code: "SAVE", target_products: [],
    }]} products={new Map()} disabled={false} onSelectBundle={vi.fn()} />);
    expect(screen.getByLabelText("原價 NT$300，優惠價 NT$270 起")).toBeVisible();
    expect(screen.getByText("滿 NT$1,000 · 滿 2 件 · 使用優惠碼 SAVE")).toBeVisible();
  });

  it("鎖定與套組缺貨時不能從卡片啟動選購", () => {
    const { rerender } = render(<ProductCardOffers product={product} promotions={[promotion]}
      products={new Map([[product.id, product], [pants.id, pants]])} disabled onSelectBundle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "選購套組：衣褲套組" })).toBeDisabled();
    rerender(<ProductCardOffers product={product} promotions={[promotion]}
      products={new Map([[product.id, product]])} disabled={false} onSelectBundle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "選購套組：衣褲套組" })).toBeDisabled();
    expect(screen.getByText("套組暫停供應")).toBeVisible();
    expect(document.querySelector("del")).not.toBeInTheDocument();
  });

  it("不在無關商品卡片上列出套組", () => {
    const { container } = render(<ProductCardOffers product={{ ...product, id: "other" }} promotions={[promotion]}
      products={new Map()} disabled={false} onSelectBundle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("同一商品有多個套組時，合併為專區入口", () => {
    render(<ProductCardOffers product={product}
      promotions={[promotion, { ...promotion, id: "second", name: "另一套組" }]}
      products={new Map([[product.id, product], [pants.id, pants]])}
      disabled={false} onSelectBundle={vi.fn()} />);
    expect(screen.getByRole("link", { name: "查看 2 組套組優惠" }))
      .toHaveAttribute("href", "#shop-bundles-title");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("另一套組")).not.toBeInTheDocument();
  });

  it("多項指定商品特價各自適用，不宣稱需要合購其他品項", () => {
    render(<ProductCardOffers product={product} promotions={[{
      ...promotion, discount_type: "price_override", discount_value: 0,
      product_price_overrides: [
        { product_id: "shirt", product_name: "衣服", unit_price: 250 },
        { product_id: "pants", product_name: "褲子", unit_price: 400 },
      ],
    }]} products={new Map([[product.id, product], [pants.id, pants]])} disabled={false} onSelectBundle={vi.fn()} />);
    expect(screen.getByLabelText("原價 NT$300，優惠價 NT$250 起")).toBeVisible();
    expect(screen.queryByText(/需同時選購/)).not.toBeInTheDocument();
  });
});
