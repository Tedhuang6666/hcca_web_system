import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassOrdersPage from "@/app/(protected)/shop/class-orders/page";

const api = vi.hoisted(() => ({
  listClassOrders: vi.fn(), classSummary: vi.fn(), catalog: vi.fn(), getCloseStatus: vi.fn(),
  getProduct: vi.fn(), createClassOrder: vi.fn(), myClass: vi.fn(), members: vi.fn(),
  setClassCollected: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ shopApi: api, classApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  Element.prototype.scrollIntoView = vi.fn();
  api.listClassOrders.mockResolvedValue([]);
  api.classSummary.mockResolvedValue({ product_rows: [] });
  api.catalog.mockResolvedValue([{ id: "category", name: "園遊會", activity_id: null, series: [], products: [
    { id: "product", name: "紀念袋", status: "active", price: 100 },
  ] }]);
  api.getProduct.mockResolvedValue({ id: "product", name: "紀念袋", price: 100, variant_groups: [] });
  api.getCloseStatus.mockResolvedValue({ statuses: {} });
  api.myClass.mockResolvedValue({ id: "class" });
  api.members.mockResolvedValue([
    { id: "a", display_name: "示範甲", seat_number: 1 },
    { id: "b", display_name: "示範乙", seat_number: 2 },
  ]);
  api.createClassOrder.mockResolvedValue([]);
});

async function chooseProduct() {
  fireEvent.change(await screen.findByLabelText("商品"), { target: { value: "product" } });
  await waitFor(() => expect(screen.getByRole("button", { name: /再加另一項商品/ })).toBeEnabled());
}

describe("班代工作流程", () => {
  it("submits one merged order per selected classmate and retains only failed recipients", async () => {
    api.createClassOrder.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("中斷")).mockResolvedValueOnce([]);
    render(<ClassOrdersPage />);
    await screen.findByLabelText(/1 號.*示範甲/);
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /再加另一項商品/ }));
    await chooseProduct();
    fireEvent.click(screen.getByLabelText(/1 號.*示範甲/));
    fireEvent.click(screen.getByLabelText(/2 號.*示範乙/));
    fireEvent.click(screen.getByRole("button", { name: /^送出 2 位/ }));
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledTimes(2));
    expect(api.createClassOrder.mock.calls[0][0]).toMatchObject({
      user_id: "a", items: [{ product_id: "product", quantity: 2, option_ids: [] }],
    });
    const retry = await screen.findByRole("button", { name: /^送出 1 位/ });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledTimes(3));
    expect(api.createClassOrder.mock.calls[2][0].user_id).toBe("b");
  });

  it("preserves the current draft when switching to collection and back", async () => {
    render(<ClassOrdersPage />);
    await screen.findByLabelText(/1 號.*示範甲/);
    await chooseProduct();
    fireEvent.click(screen.getByLabelText(/1 號.*示範甲/));
    fireEvent.click(screen.getByRole("button", { name: "班內收款" }));
    expect(screen.queryByRole("combobox", { name: "商品" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "幫同學訂購" }));
    expect(screen.getByLabelText(/1 號.*示範甲/)).toBeChecked();
    expect(screen.getByRole("button", { name: /^送出 1 位/ })).toBeEnabled();
  });

  it("does not count cancelled orders or another activity when collecting by seat", async () => {
    api.listClassOrders.mockResolvedValue([
      { id: "one", serial_number: "1", user_id: "a", status: "pending", total_price: 100, activity_id: null, is_class_collected: false },
      { id: "cancel", serial_number: "2", user_id: "a", status: "cancelled", total_price: 500, activity_id: null },
      { id: "other", serial_number: "3", user_id: "a", status: "pending", total_price: 300, activity_id: "other", is_class_collected: false },
    ]);
    api.setClassCollected.mockResolvedValue({});
    render(<ClassOrdersPage />);
    await screen.findByLabelText(/1 號.*示範甲/);
    fireEvent.click(screen.getByRole("button", { name: "班內收款" }));
    fireEvent.change(screen.getByLabelText("活動", { selector: "select" }), { target: { value: "none" } });
    fireEvent.click(screen.getAllByRole("button", { name: "設為已收" }).find((button) => !button.hasAttribute("disabled"))!);
    await waitFor(() => expect(api.setClassCollected).toHaveBeenCalledTimes(1));
    expect(api.setClassCollected).toHaveBeenCalledWith("one", true);
  });
});
