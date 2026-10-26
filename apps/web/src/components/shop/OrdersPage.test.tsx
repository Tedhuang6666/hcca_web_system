import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrdersPage from "@/app/(protected)/shop/orders/page";
import type { OrderListItem } from "@/lib/types";

const api = vi.hoisted(() => ({
  listOrders: vi.fn(), listDelegatedOrders: vi.fn(), catalog: vi.fn(), getProduct: vi.fn(),
  myClass: vi.fn(), recipientOptions: vi.fn(), myCorrectionRequests: vi.fn(),
  createCorrectionRequest: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  shopApi: api,
  classApi: api,
  apiErrorMessage: (_: unknown, fallback: string) => fallback,
}));
vi.mock("@/hooks/useWS", () => ({ useWS: vi.fn() }));

const order: OrderListItem = {
  id: "first", serial_number: "ORDER-001", user_id: "student", class_id: "class",
  activity_id: "festival", activity_name: "校慶", assistance_scope: "self",
  status: "pending", is_class_collected: true, is_paid: false,
  created_at: "2026-10-10T00:00:00Z", payment_method: "cash_on_pickup",
  total_price: 200, subtotal_price: 200, discount_amount: 0,
  items: [{ id: "bag", product_id: "bag", product_name: "紀念袋", quantity: 2,
    unit_price: 100, subtotal: 200, selected_options: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listOrders.mockResolvedValue([]);
  api.listDelegatedOrders.mockResolvedValue([]);
  api.catalog.mockResolvedValue([]);
  api.getProduct.mockResolvedValue({ image_url: null });
  api.myClass.mockResolvedValue(null);
  api.recipientOptions.mockResolvedValue([{ id: "class", label: "一年一班" }]);
  api.myCorrectionRequests.mockResolvedValue([]);
});

describe("我的預購", () => {
  it("優惠套用後在活動合計顯示刪除線原價與實付價", async () => {
    api.listOrders.mockResolvedValue([{ ...order, subtotal_price: 200, discount_amount: 50, total_price: 150 }]);
    render(<OrdersPage />);
    const activity = await screen.findByRole("region", { name: "校慶預購" });
    expect(activity.querySelector("del")).toHaveTextContent("NT$200");
    expect(within(activity).getByLabelText("原價 NT$200，優惠價 NT$150")).toBeVisible();
  });
  it("shows activity items and supplemental payment without order numbers or counts", async () => {
    api.catalog.mockResolvedValue([{
      products: [{ id: "bag", image_url: "/uploads/bag.png" }],
      series: [],
    }]);
    api.listOrders.mockResolvedValue([order, {
      ...order, id: "addition", is_class_collected: false, total_price: 100,
      items: [{ ...order.items![0], id: "more", quantity: 1, subtotal: 100 }],
    }, { ...order, id: "cancelled", status: "cancelled", total_price: 500 }]);
    render(<OrdersPage />);
    expect(await screen.findByRole("heading", { name: "預購品項" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "下一步" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /待繳 NT\$/ })).not.toBeInTheDocument();
    const activity = await screen.findByRole("region", { name: "校慶預購" });
    expect(within(activity).getByText("合計 NT$300")).toBeVisible();
    expect(within(activity).getByText("已繳 NT$200 · 待補繳 NT$100")).toBeVisible();
    const items = within(activity).getByRole("list", { name: "校慶品項" });
    expect(within(items).getAllByRole("listitem")).toHaveLength(1);
    expect(within(items).getByText("× 3")).toBeVisible();
    expect(await screen.findByAltText("")).toHaveAttribute(
      "src", expect.stringContaining("bag.png"),
    );
    expect(screen.queryByText("ORDER-001")).not.toBeInTheDocument();
    expect(screen.queryByText(/筆訂單/)).not.toBeInTheDocument();
    expect(screen.queryByText("登記資訊")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看校慶預購詳情" }))
      .toHaveAttribute("href", "/shop/orders/first");
    expect(api.listOrders).toHaveBeenCalledWith({ limit: "500", offset: "0", my_only: "true" });
  });

  it("shows an empty state when every registration was cancelled or refunded", async () => {
    api.listOrders.mockResolvedValue([{ ...order, status: "cancelled" }, { ...order, status: "refunded" }]);
    render(<OrdersPage />);
    expect(await screen.findByText("目前沒有預購品項，先到商品頁挑選商品。")).toBeVisible();
    expect(screen.getByRole("link", { name: "去選購商品" })).toHaveAttribute("href", "/shop");
    expect(screen.queryByRole("region", { name: "校慶預購" })).not.toBeInTheDocument();
  });

  it("connects the class correction request to the student's order page", async () => {
    render(<OrdersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "申請加入班級" }));
    expect(await screen.findByLabelText("你目前就讀的班級")).toBeVisible();
    expect(api.myClass).toHaveBeenCalledOnce();
    expect(api.recipientOptions).toHaveBeenCalledOnce();
    expect(api.myCorrectionRequests).toHaveBeenCalledOnce();
  });

  it("includes student orders where the current user added delegated items", async () => {
    api.listDelegatedOrders.mockResolvedValue([{
      order: { ...order, id: "student-order", user_name: "小明" },
      editable_item_ids: ["mom-item"],
    }]);
    render(<OrdersPage />);

    const activity = await screen.findByRole("region", { name: "校慶預購" });
    expect(await within(activity).findByText("明細中只能修改你代訂的品項，其他來源僅供查看。"))
      .toBeVisible();
    expect(within(activity).getByText("× 2")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看校慶預購詳情" }))
      .toHaveAttribute("href", "/shop/orders/student-order");
    expect(api.listDelegatedOrders).toHaveBeenCalledWith({ limit: "500", offset: "0" });
  });

  it("allows retry after failure and links to the order details when items are absent", async () => {
    api.listOrders.mockRejectedValueOnce(new Error("連線失敗")).mockResolvedValueOnce([{ ...order, items: undefined }]);
    render(<OrdersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入登記紀錄，請重試。");
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(await screen.findByText("品項資訊請查看訂單詳情。")).toBeVisible();
    expect(screen.queryByText("登記資訊")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看校慶預購詳情" }))
      .toHaveAttribute("href", "/shop/orders/first");
  });
});
