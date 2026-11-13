import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import BundleOffer from "./BundleOffer";

function product(id: string, name: string, price: number): CatalogProductOut {
  return { id, name, price, status: "active", is_unlimited: true, stock_quantity: 0,
    purchase_allowed: true, has_variants: false, has_option_surcharge: false,
    requires_seating: false };
}

const hoodie = product("hoodie", "帽T", 600);
const jacket = product("jacket", "風衣外套", 750);
const shirt = product("shirt", "棉T", 300);
const sportShirt = product("sport-shirt", "排汗衫", 300);
const shorts = product("shorts", "排汗短褲", 250);
const cap = product("cap", "刺繡老帽", 250);
const catalog = [hoodie, jacket, shirt, sportShirt, shorts, cap];
const products = new Map(catalog.map((row) => [row.id, row]));
const fullSet: ShopPromotionPublicOut = {
  id: "full-set", name: "總匯套餐", discount_type: "bundle_price", discount_value: 2150,
  min_order_price: 0, min_quantity: 1, gift_quantity: 1,
  target_products: [hoodie, jacket, shirt, sportShirt, shorts],
};
const jacketSet: ShopPromotionPublicOut = {
  ...fullSet, id: "jacket-set", name: "家豪套餐", discount_value: 867,
  target_products: [jacket, cap],
};
const sportSet: ShopPromotionPublicOut = {
  ...fullSet, id: "sport-set", name: "運動套餐", discount_value: 500,
  target_products: [sportShirt, shorts],
};
const promotions = [fullSet, jacketSet, sportSet];
const order: OrderOut = {
  id: "registration", serial_number: "TEST-ORDER", user_id: "student", status: "pending",
  assistance_scope: "self", payment_method: "cash_on_pickup", subtotal_price: 3650,
  discount_amount: 183, total_price: 3467, is_paid: false, is_class_collected: false,
  created_at: "2026-11-12T00:00:00Z", updated_at: "2026-11-12T00:00:00Z",
  applied_promotions: [
    { promotion_id: jacketSet.id, name: jacketSet.name, discount_amount: 133 },
    { promotion_id: sportSet.id, name: sportSet.name, discount_amount: 50 },
  ],
  items: catalog.map((row) => {
    const quantity = row.id === shirt.id ? 4 : row.id === sportShirt.id ? 2 : 1;
    return { id: `item-${row.id}`, product_id: row.id, product_name: row.name,
      quantity, unit_price: row.price, subtotal: row.price * quantity,
      selected_options: [], gift_quantity: 0, gift_discount_amount: 0 };
  }),
};

function offer(registration: OrderOut | null = order, promotion = fullSet) {
  return <BundleOffer promotion={promotion} promotions={promotions} products={products}
    registration={registration} disabled={false} onSelect={vi.fn()} />;
}

describe("套組擇優套用提示", () => {
  it("總匯商品已齊，但較優惠的重疊套餐已套用時變灰並停用選購", () => {
    const onSelect = vi.fn();
    render(<BundleOffer promotion={fullSet} promotions={promotions} products={products}
      registration={order} disabled={false} onSelect={onSelect} />);

    expect(screen.getByRole("article", { name: "總匯套餐" })).toHaveAttribute("data-replaced", "true");
    expect(screen.getByRole("status")).toHaveTextContent("已套用其他更優惠的套餐");
    expect(screen.queryByText(/已湊齊|再選/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "未套用" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("已套用的套餐保留正常樣式及調整入口", () => {
    render(offer(order, jacketSet));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
    expect(screen.getByRole("status")).toHaveTextContent("已套用優惠");
    expect(screen.getByRole("button", { name: "調整套組" })).toBeEnabled();
  });

  it("尚未選購、尚未湊齊或尚未實際套用優惠時，不顯示已被取代", () => {
    const view = render(offer(null));
    expect(screen.getByRole("button", { name: "選購套組" })).toBeEnabled();
    expect(screen.queryByText("已套用其他更優惠的套餐")).not.toBeInTheDocument();
    view.rerender(offer({ ...order, items: order.items.filter((item) => item.product_id !== jacket.id) }));
    expect(screen.getByRole("button", { name: "繼續湊組" })).toBeEnabled();
    expect(screen.queryByText("已套用其他更優惠的套餐")).not.toBeInTheDocument();
    view.rerender(offer({ ...order, applied_promotions: [], discount_amount: 0 }));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
  });

  it("仍有足夠剩餘件數可另湊套餐時，保留選購入口", () => {
    render(offer({ ...order, items: order.items.map((item) =>
      [hoodie.id, jacket.id, shorts.id].includes(item.product_id) ? { ...item, quantity: 2 } : item) }));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
    expect(screen.getByRole("button", { name: "繼續湊組" })).toBeEnabled();
  });

  it("只有較少或相同折抵的重疊套餐時，不宣稱已有更優惠套餐", () => {
    const view = render(offer({ ...order, applied_promotions: [order.applied_promotions![1]] }));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
    view.rerender(offer({ ...order, applied_promotions: [order.applied_promotions![1]] },
      { ...fullSet, discount_value: 2020 }));
    expect(screen.queryByText("已套用其他更優惠的套餐")).not.toBeInTheDocument();
  });

  it("用實際售價比較折抵，不將原價比較標示當成折抵金額", () => {
    const markedProducts = new Map(catalog.map((row) => [row.id, { ...row, original_price: row.price + 100 }]));
    render(<BundleOffer promotion={fullSet} promotions={promotions} products={markedProducts}
      registration={order} disabled={false} onSelect={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("已套用其他更優惠的套餐");
  });

  it("沒有商品價格或僅有未知優惠紀錄時，不猜測取代原因", () => {
    const view = render(<BundleOffer promotion={fullSet} promotions={promotions} products={new Map()}
      registration={order} disabled={false} onSelect={vi.fn()} />);
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
    view.rerender(offer({ ...order, applied_promotions: [{
      promotion_id: "unknown", name: "其他優惠", discount_amount: 1000,
    }] }));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
  });

  it("贈品件數或未達門檻造成不符合時，不誤稱被套餐取代", () => {
    const view = render(offer({ ...order, items: order.items.map((item) =>
      item.product_id === hoodie.id ? { ...item, gift_quantity: 1 } : item) }));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
    view.rerender(offer(order, { ...fullSet, min_order_price: 5000 }));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
  });

  it("優惠重算後移除取代狀態，恢復原本的套組操作", () => {
    const view = render(offer());
    expect(screen.getByRole("button", { name: "未套用" })).toBeDisabled();
    view.rerender(offer({ ...order, applied_promotions: [], discount_amount: 0 }));
    expect(screen.getByRole("article")).not.toHaveAttribute("data-replaced");
    expect(screen.getByRole("button", { name: "繼續湊組" })).toBeEnabled();
  });

  it("相容只有單一優惠欄位的既有登記資料", () => {
    render(offer({ ...order, applied_promotions: [], promotion_id: jacketSet.id, discount_amount: 133 }));
    expect(screen.getByRole("status")).toHaveTextContent("已套用其他更優惠的套餐");
  });
});
