import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderDetailPage from "@/app/(public)/shop/orders/[id]/page";
import type { OrderOut } from "@/lib/types";

const api = vi.hoisted(() => ({
  me: vi.fn(),
  getOrder: vi.fn(),
  listOrders: vi.fn(),
  getCurrentRegistrations: vi.fn(),
  catalog: vi.fn(),
  getCloseStatus: vi.fn(),
  getProduct: vi.fn(),
  orderAssignments: vi.fn(),
  listZones: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  authApi: { me: api.me },
  shopApi: {
    getOrder: api.getOrder,
    listOrders: api.listOrders,
    getCurrentRegistrations: api.getCurrentRegistrations,
    catalog: api.catalog,
    getCloseStatus: api.getCloseStatus,
    getProduct: api.getProduct,
  },
  seatingApi: {
    orderAssignments: api.orderAssignments,
    listZones: api.listZones,
  },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("@/hooks/useWS", () => ({ useWS: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "first" }),
  useSearchParams: () => new URLSearchParams(),
}));

const firstOrder = {
  id: "first",
  serial_number: "ORDER-001",
  user_id: "student",
  activity_id: "festival",
  activity_name: "校慶",
  category_id: "goods",
  category_name: "紀念品",
  status: "pending",
  subtotal_price: 200,
  discount_amount: 0,
  total_price: 200,
  promotion_id: null,
  promotion_code: null,
  applied_promotions: [],
  payment_method: "cash_on_pickup",
  notes: null,
  class_id: "class",
  class_label: "一年一班",
  assistance_scope: "self",
  assisted_by_id: null,
  is_paid: false,
  is_class_collected: true,
  class_collected_at: null,
  paid_at: null,
  created_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
  items: [{
    id: "bag-first",
    product_id: "bag",
    product_name: "紀念袋",
    quantity: 2,
    unit_price: 100,
    subtotal: 200,
    selected_options: [],
  }],
} as OrderOut;

const addedOrder: OrderOut = {
  ...firstOrder,
  id: "added",
  serial_number: "ORDER-002",
  total_price: 100,
  subtotal_price: 100,
  is_class_collected: false,
  created_at: "2026-10-10T01:00:00Z",
  items: [{ ...firstOrder.items[0], id: "bag-added", quantity: 1, subtotal: 100 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  api.me.mockResolvedValue({ id: "student" });
  api.getOrder.mockImplementation(async (id: string) => id === "added" ? addedOrder : firstOrder);
  api.listOrders.mockResolvedValue([firstOrder, addedOrder]);
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.getProduct.mockResolvedValue({ requires_seating: false });
  api.orderAssignments.mockResolvedValue([]);
  api.listZones.mockResolvedValue([]);
});

describe("公開訂單詳情", () => {
  it("combines every preorder from the same activity into one detail view", async () => {
    render(<OrderDetailPage />);

    expect(await screen.findByRole("heading", { name: "校慶" })).toBeVisible();
    expect(screen.getByText("活動預購總額").parentElement).toHaveTextContent("NT$300");
    expect(screen.getAllByText("NT$300").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/×\s*3/)).toBeVisible();
    expect(screen.getByText("已繳金額")).toBeVisible();
    expect(screen.getByText("NT$200")).toBeVisible();
    expect(screen.queryByText(/ORDER-/)).not.toBeInTheDocument();
    expect(api.getOrder).toHaveBeenCalledWith("added");
  });

  it("asks visitors to log in before requesting private order data", async () => {
    api.me.mockResolvedValue(null);
    render(<OrderDetailPage />);

    expect(await screen.findByRole("heading", { name: "登入後查看預購" })).toBeVisible();
    expect(screen.getByRole("link", { name: "登入" }))
      .toHaveAttribute("href", "/login?next=%2Fshop%2Forders%2Ffirst");
    expect(api.getOrder).not.toHaveBeenCalled();
  });
});
