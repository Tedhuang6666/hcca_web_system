import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogProductOut, ShopPromotionPublicOut } from "@/lib/types";
import ProductCardOffers from "./ProductCardOffers";

const product: CatalogProductOut = {
  id: "shirt", name: "衣服", price: 300, status: "active", image_url: null,
  stock_quantity: 50, purchase_allowed: true, is_unlimited: true, has_variants: true, requires_seating: false,
  has_option_surcharge: true, seating_mode: null, sale_start: null, sale_end: null,
};
const pants = { ...product, id: "pants", name: "褲子", price: 500 };
const promotion: ShopPromotionPublicOut = {
  id: "bundle", name: "衣褲套組", activity_id: null, code: null,
  discount_type: "bundle_price", discount_value: 650, min_order_price: 0, min_quantity: 1,
  target_products: [{ id: "shirt", name: "衣服" }, { id: "pants", name: "褲子" }],
};

describe("商品卡片內的優惠", () => {
  it("贈品顯示免費基本售價，並說明自行選規格與加價自付", () => {
    render(<ProductCardOffers product={product} promotions={[{
      ...promotion, name: "抽獎贈品", discount_type: "percentage", discount_value: 100,
      target_products: [{ id: "shirt", name: "衣服" }],
    }]} products={new Map()} disabled={false} onSelectBundle={vi.fn()} />);
    fireEvent.click(screen.getByText("查看 1 項優惠"));
    expect(screen.getByLabelText("原價 NT$300，優惠價 NT$0 起")).toBeVisible();
    expect(screen.getByText("符合條件自動套用 · 規格加價另計")).toBeVisible();
    expect(screen.getByText("請自行選擇規格；商品基本售價免費，加價選項由您支付。")).toBeVisible();
    expect(screen.getByText("贈品：衣服")).toBeVisible();
  });

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

  it("展開條件式優惠後可查看件數、金額與優惠碼", () => {
    render(<ProductCardOffers product={product} promotions={[{
      ...promotion, discount_type: "percentage", discount_value: 10, min_quantity: 2,
      min_order_price: 1000, code: "SAVE", target_products: [],
    }]} products={new Map()} disabled={false} onSelectBundle={vi.fn()} />);
    expect(screen.getByText("滿 NT$1,000 · 滿 2 件 · 使用優惠碼 SAVE")).not.toBeVisible();
    fireEvent.click(screen.getByText("查看 1 項優惠"));
    expect(screen.getByLabelText("原價 NT$300，優惠價 NT$270 起")).toBeVisible();
    expect(screen.getByText("滿 NT$1,000 · 滿 2 件 · 使用優惠碼 SAVE")).toBeVisible();
  });

  it("有規格但都免加價時不顯示起價", () => {
    render(<ProductCardOffers product={{ ...product, has_option_surcharge: false }} promotions={[{
      ...promotion, discount_type: "percentage", discount_value: 10,
      min_quantity: 1, min_order_price: 0, target_products: [],
    }]} products={new Map()} disabled={false} onSelectBundle={vi.fn()} />);
    fireEvent.click(screen.getByText("查看 1 項優惠"));
    expect(screen.getByLabelText("原價 NT$300，優惠價 NT$270")).toBeVisible();
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
    fireEvent.click(screen.getByText("查看 1 項優惠"));
    expect(screen.getByLabelText("原價 NT$300，優惠價 NT$250 起")).toBeVisible();
    expect(screen.queryByText(/需同時選購/)).not.toBeInTheDocument();
  });

  it("同組指定價只有零元商品標為贈品", () => {
    const offer: ShopPromotionPublicOut = { ...promotion, discount_type: "price_override", product_price_overrides: [
      { product_id: "shirt", product_name: "衣服", unit_price: 0 },
      { product_id: "pants", product_name: "褲子", unit_price: 400 },
    ] };
    const view = render(<ProductCardOffers product={product} promotions={[offer]}
      products={new Map()} disabled={false} onSelectBundle={vi.fn()} />);
    fireEvent.click(screen.getByText("查看 1 項優惠"));
    expect(screen.getByText("贈品：衣服")).toBeVisible();
    view.rerender(<ProductCardOffers product={pants} promotions={[offer]}
      products={new Map()} disabled={false} onSelectBundle={vi.fn()} />);
    expect(screen.queryByText(/贈品：/)).not.toBeInTheDocument();
  });

  it("多項優惠預設合併收起，展開與收合不影響套組入口", () => {
    const select = vi.fn();
    render(<ProductCardOffers product={product} promotions={[promotion, {
      ...promotion, id: "threshold", name: "Six Seven！！！", discount_type: "fixed",
      discount_value: 67, min_order_price: 6767, target_products: [],
    }, {
      ...promotion, id: "gift", name: "抽獎贈品", discount_type: "percentage",
      discount_value: 100, target_products: [{ id: product.id, name: product.name }],
    }]} products={new Map([[product.id, product], [pants.id, pants]])}
      disabled={false} onSelectBundle={select} />);
    const toggle = screen.getByText("查看 2 項優惠");
    const conditions = screen.getByText("滿 NT$6,767 · 符合條件自動套用");
    expect(screen.getByText("Six Seven！！！")).not.toBeVisible();
    expect(conditions).not.toBeVisible();
    expect(screen.getByText("贈品：衣服")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "選購套組：衣褲套組" }));
    expect(select).toHaveBeenCalledWith(promotion);
    fireEvent.click(toggle);
    expect(conditions).toBeVisible();
    expect(screen.getByText("整筆登記折抵 NT$67")).toBeVisible();
    expect(screen.getByText("贈品：衣服")).toBeVisible();
    fireEvent.click(toggle);
    expect(conditions).not.toBeVisible();
  });
});
