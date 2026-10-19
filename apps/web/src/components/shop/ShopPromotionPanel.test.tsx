import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ShopPromotionPanel from "@/app/(protected)/shop/admin/ShopPromotionPanel";
import type { ShopPromotionOut } from "@/lib/types";

const api = vi.hoisted(() => ({
  listPromotions: vi.fn(),
  listProducts: vi.fn(),
  catalog: vi.fn(),
  updatePromotion: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  shopApi: api,
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const pendingStudentTarget = {
  id: "promotion-1",
  name: "新生註冊優惠",
  activity_id: null,
  code: null,
  target_user_id: null,
  target_email: null,
  target_users: [{ email: null, student_id: "410999" }],
  target_products: [],
  product_price_overrides: [],
  discount_type: "percentage",
  discount_value: 10,
  min_order_price: 0,
  min_quantity: 1,
  starts_at: null,
  ends_at: null,
  max_uses: null,
  used_count: 0,
  is_active: true,
  is_public: true,
  description: null,
} as unknown as ShopPromotionOut;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  api.listPromotions.mockResolvedValue([pendingStudentTarget]);
  api.listProducts.mockResolvedValue([]);
  api.catalog.mockResolvedValue([]);
  api.updatePromotion.mockResolvedValue(pendingStudentTarget);
});

describe("優惠管理的預先指定學號", () => {
  it("顯示尚未註冊的學號，並在編輯時保留該學號", async () => {
    render(<ShopPromotionPanel />);

    expect(await screen.findByText(/學號 410999/)).toBeVisible();
    expect(screen.getByText(/學號可先指定，對應帳號註冊後即可使用/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("textbox", { name: /可使用帳號（選填）/ })).toHaveValue("410999");

    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));
    await waitFor(() => {
      expect(api.updatePromotion).toHaveBeenCalledWith(
        "promotion-1",
        expect.objectContaining({ target_identifiers: ["410999"] }),
      );
    });
  });
});
