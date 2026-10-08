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
    { id: "shirt", name: "紀念衫", status: "active", price: 200 },
  ] }]);
  api.getProduct.mockImplementation(async (id: string) => id === "shirt"
    ? { id, name: "紀念衫", price: 200, variant_groups: [{ id: "size", name: "尺寸", options: [
      { id: "medium", value: "M", is_active: true, price_delta: 0 },
      { id: "large", value: "L", is_active: true, price_delta: 20 },
    ] }] }
    : { id, name: "紀念袋", price: 100, variant_groups: [] });
  api.getCloseStatus.mockResolvedValue({ statuses: {} });
  api.myClass.mockResolvedValue({ id: "class" });
  api.members.mockResolvedValue([
    { id: "a", display_name: "示範甲", seat_number: 1 },
    { id: "b", display_name: "示範乙", seat_number: 2 },
  ]);
  api.createClassOrder.mockResolvedValue([]);
});

async function chooseStudent(id = "a") {
  await screen.findByRole("option", { name: "1 號 · 示範甲" });
  fireEvent.change(screen.getByRole("combobox", { name: "同班學生" }), { target: { value: id } });
}

async function chooseProduct(id = "product") {
  fireEvent.change(await screen.findByLabelText("商品"), { target: { value: id } });
  if (id === "shirt") fireEvent.click(await screen.findByRole("radio", { name: "M" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /加入清單，繼續選商品/ })).toBeEnabled());
}

describe("班代工作流程", () => {
  it("builds a multi-product order for one student with merged quantities and the chosen variant", async () => {
    render(<ClassOrdersPage />);
    expect(screen.getByRole("combobox", { name: "商品" })).toBeDisabled();
    await chooseStudent();
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /加入清單，繼續選商品/ }));
    expect(screen.getByRole("combobox", { name: "同班學生" })).toHaveValue("a");
    expect(screen.getByRole("combobox", { name: "同班學生" })).toBeDisabled();
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /加入清單，繼續選商品/ }));
    await chooseProduct("shirt");
    fireEvent.click(screen.getByRole("radio", { name: /L/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /^數量$/ }), { target: { value: "2" } });
    expect(screen.getByRole("spinbutton", { name: "紀念袋數量" })).toHaveValue(2);
    expect(screen.getByRole("heading", { name: "示範甲的商品清單" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "送出示範甲的訂單 · 小計 NT$640" }));
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledTimes(1));
    expect(api.createClassOrder.mock.calls[0][0]).toEqual({
      user_id: "a", notes: null, items: [
        { product_id: "product", quantity: 2, option_ids: [] },
        { product_id: "shirt", quantity: 2, option_ids: ["large"] },
      ],
    });
  });

  it("queues one student's products before selecting the next and retries only failed drafts", async () => {
    api.createClassOrder.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("中斷")).mockResolvedValueOnce([]);
    render(<ClassOrdersPage />);
    await chooseStudent();
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /加入清單，繼續選商品/ }));
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: "加入待送出，登記下一位" }));
    expect(screen.getByRole("combobox", { name: "同班學生" })).toHaveValue("");
    await chooseStudent("b");
    await chooseProduct("shirt");
    fireEvent.click(screen.getByRole("button", { name: /^送出待送出清單（2 位）/ }));
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledTimes(2));
    expect(api.createClassOrder.mock.calls[0][0]).toMatchObject({
      user_id: "a", items: [{ product_id: "product", quantity: 2, option_ids: [] }],
    });
    const retry = await screen.findByRole("button", { name: /^送出待送出清單（1 位）/ });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledTimes(3));
    expect(api.createClassOrder.mock.calls[2][0]).toMatchObject({
      user_id: "b", items: [{ product_id: "shirt", quantity: 1, option_ids: ["medium"] }],
    });
  });

  it("preserves the current draft when switching to collection and back", async () => {
    render(<ClassOrdersPage />);
    await chooseStudent();
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: "班內收款" }));
    expect(screen.queryByRole("combobox", { name: "商品" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "幫同學訂購" }));
    expect(screen.getByRole("combobox", { name: "同班學生" })).toHaveValue("a");
    expect(screen.getByRole("button", { name: /^送出示範甲的訂單/ })).toBeEnabled();
  });

  it("does not count cancelled orders or another activity when collecting by seat", async () => {
    api.listClassOrders.mockResolvedValue([
      { id: "one", serial_number: "1", user_id: "a", status: "pending", total_price: 100, activity_id: null, is_class_collected: false },
      { id: "cancel", serial_number: "2", user_id: "a", status: "cancelled", total_price: 500, activity_id: null },
      { id: "other", serial_number: "3", user_id: "a", status: "pending", total_price: 300, activity_id: "other", is_class_collected: false },
    ]);
    api.setClassCollected.mockResolvedValue({});
    render(<ClassOrdersPage />);
    await screen.findByRole("option", { name: "1 號 · 示範甲" });
    fireEvent.click(screen.getByRole("button", { name: "班內收款" }));
    fireEvent.change(screen.getByLabelText("活動", { selector: "select" }), { target: { value: "none" } });
    fireEvent.click(screen.getAllByRole("button", { name: "設為已收" }).find((button) => !button.hasAttribute("disabled"))!);
    await waitFor(() => expect(api.setClassCollected).toHaveBeenCalledTimes(1));
    expect(api.setClassCollected).toHaveBeenCalledWith("one", true);
  });
});
