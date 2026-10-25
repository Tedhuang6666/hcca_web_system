import { beforeEach, expect, it, vi } from "vitest";
import type { OrderOut, ShopPromotionPreviewOut } from "@/lib/types";
import { refreshAutomaticRegistrationPromotions } from "@/lib/shop-registration-promotions";

const api = vi.hoisted(() => ({
  previewCurrentPromotion: vi.fn(),
  applyCurrentPromotion: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ shopApi: api }));

const order: OrderOut = {
  id: "order-1", user_id: "user-1", activity_id: "activity-1", category_id: "category-1",
  status: "pending", serial_number: "ORDER-001", created_at: "2026-10-25T00:00:00Z",
  updated_at: "2026-10-25T00:00:00Z", subtotal_price: 200, discount_amount: 0, total_price: 200,
  promotion_id: null, promotion_code: null, applied_promotions: [], is_paid: false,
  is_class_collected: false, assistance_scope: "self", payment_method: "cash_on_pickup", items: [{
    id: "item-1", product_id: "product-1", product_name: "商品", quantity: 2,
    unit_price: 100, subtotal: 200, selected_options: [],
  }],
};

function preview(overrides: Partial<ShopPromotionPreviewOut> = {}): ShopPromotionPreviewOut {
  return {
    eligible: false, reason_code: "no_promotion", subtotal_price: 200, discount_amount: 0,
    total_price: 200, shortfall: 0, quantity_shortfall: 0, ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.previewCurrentPromotion.mockResolvedValue(preview());
});

it("applies the latest automatic promotion to an existing unpaid registration", async () => {
  const updated: OrderOut = {
    ...order, promotion_id: "cadre-promo", discount_amount: 40, total_price: 160,
    applied_promotions: [{ promotion_id: "cadre-promo", name: "幹部優惠", code: null, discount_amount: 40 }],
  };
  api.previewCurrentPromotion.mockResolvedValue(preview({
    eligible: true, reason_code: "applied", promotion_name: "幹部優惠",
    subtotal_price: 200, discount_amount: 40, total_price: 160,
  }));
  api.applyCurrentPromotion.mockResolvedValue(updated);

  await expect(refreshAutomaticRegistrationPromotions([order])).resolves.toEqual([updated]);
  expect(api.previewCurrentPromotion).toHaveBeenCalledWith(null, "activity-1", null);
  expect(api.applyCurrentPromotion).toHaveBeenCalledWith(null, "activity-1", null);
});

it("recalculates changed discounts and clears an automatic promotion that is no longer eligible", async () => {
  const previouslyDiscounted: OrderOut = {
    ...order, promotion_id: "old-promo", discount_amount: 20, total_price: 180,
    applied_promotions: [{ promotion_id: "old-promo", name: "幹部優惠", code: null, discount_amount: 20 }],
  };
  const updated: OrderOut = { ...previouslyDiscounted, promotion_id: null, discount_amount: 0,
    total_price: 200, applied_promotions: [] };
  api.applyCurrentPromotion.mockResolvedValue(updated);

  await expect(refreshAutomaticRegistrationPromotions([previouslyDiscounted])).resolves.toEqual([updated]);
  expect(api.applyCurrentPromotion).toHaveBeenCalledOnce();
});

it("updates an existing automatic discount when its current value changes", async () => {
  const previouslyDiscounted: OrderOut = {
    ...order, promotion_id: "cadre-promo", discount_amount: 20, total_price: 180,
    applied_promotions: [{ promotion_id: "cadre-promo", name: "幹部優惠", code: null, discount_amount: 20 }],
  };
  const updated: OrderOut = {
    ...previouslyDiscounted, discount_amount: 50, total_price: 150,
    applied_promotions: [{ promotion_id: "cadre-promo", name: "幹部優惠", code: null, discount_amount: 50 }],
  };
  api.previewCurrentPromotion.mockResolvedValue(preview({
    eligible: true, reason_code: "applied", promotion_name: "幹部優惠",
    subtotal_price: 200, discount_amount: 50, total_price: 150,
  }));
  api.applyCurrentPromotion.mockResolvedValue(updated);

  await expect(refreshAutomaticRegistrationPromotions([previouslyDiscounted])).resolves.toEqual([updated]);
  expect(api.applyCurrentPromotion).toHaveBeenCalledWith(null, "activity-1", null);
});

it("does not write again when the saved automatic promotion matches the current preview", async () => {
  const current: OrderOut = {
    ...order, promotion_id: "cadre-promo", discount_amount: 40, total_price: 160,
    applied_promotions: [{ promotion_id: "cadre-promo", name: "幹部優惠", code: null, discount_amount: 40 }],
  };
  api.previewCurrentPromotion.mockResolvedValue(preview({
    eligible: true, reason_code: "applied", promotion_name: "幹部優惠",
    subtotal_price: 200, discount_amount: 40, total_price: 160,
  }));

  await expect(refreshAutomaticRegistrationPromotions([current])).resolves.toEqual([current]);
  expect(api.applyCurrentPromotion).not.toHaveBeenCalled();
});

it("does not write when neither the saved order nor current settings have an automatic promotion", async () => {
  await expect(refreshAutomaticRegistrationPromotions([order])).resolves.toEqual([order]);
  expect(api.previewCurrentPromotion).toHaveBeenCalledOnce();
  expect(api.applyCurrentPromotion).not.toHaveBeenCalled();
});

it("leaves paid, locked, testing, and manually coded orders untouched", async () => {
  const cases = [
    { ...order, is_paid: true },
    { ...order, is_class_collected: true },
    { ...order, test_product_id: "test-product" },
    { ...order, promotion_code: "MANUAL" },
  ];

  await expect(refreshAutomaticRegistrationPromotions(cases)).resolves.toEqual(cases);
  expect(api.previewCurrentPromotion).not.toHaveBeenCalled();
  expect(api.applyCurrentPromotion).not.toHaveBeenCalled();
});
