import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    { id: "badge", name: "紀念徽章", status: "active", price: 50 },
  ] }]);
  api.getProduct.mockImplementation(async (id: string) => id === "badge"
    ? { id, name: "紀念徽章", price: 50, variant_groups: [{ id: "color", name: "顏色", options: Array.from({ length: 30 }, (_, index) => ({
      id: `color-${index + 1}`, value: `色票${index + 1}`, is_active: true, price_delta: 0,
    })) }] }
    : id === "shirt"
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
  const singleMode = screen.getByRole("button", { name: "逐位代訂" });
  if (singleMode.getAttribute("aria-pressed") !== "true") fireEvent.click(singleMode);
  await screen.findByRole("option", { name: "1 號 · 示範甲" });
  fireEvent.change(screen.getByRole("combobox", { name: "同班學生" }), { target: { value: id } });
}

async function chooseProduct(id = "product") {
  const search = screen.getByRole("searchbox", { name: "搜尋商品" });
  const productName = id === "shirt" ? /紀念衫/ : /紀念袋/;
  const results = screen.getByRole("group", { name: "商品搜尋結果" });
  fireEvent.change(search, { target: { value: id === "shirt" ? "紀念衫" : "紀念袋" } });
  fireEvent.click(await within(results).findByRole("button", { name: productName }));
  if (id === "shirt") fireEvent.click(await screen.findByRole("radio", { name: "M" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /加入清單，繼續選商品/ })).toBeEnabled());
}

function openOrderWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "幫同學訂購" }));
}

function openCollectWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "依活動與座號收款" }));
}

describe("班代工作流程", () => {
  it("opens single-student ordering first, then sorts the collection roster by seat number", async () => {
    api.members.mockResolvedValue([
      { id: "b", display_name: "示範乙", seat_number: 2 },
      { id: "a", display_name: "示範甲", seat_number: 1 },
    ]);
    render(<ClassOrdersPage />);

    expect(screen.getByRole("button", { name: "幫同學訂購" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "逐位代訂" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "批次給多人" })).toHaveAttribute("aria-pressed", "false");
    openCollectWorkspace();
    const table = await screen.findByRole("table", { name: "園遊會各座號收款" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["1 號", "2 號"]);
    expect(within(table).queryByRole("columnheader", { name: "訂單" })).not.toBeInTheDocument();
  });

  it("shows a clear message when there are no activities to collect", async () => {
    api.catalog.mockResolvedValue([]);
    render(<ClassOrdersPage />);

    openCollectWorkspace();
    expect(await screen.findByRole("status")).toHaveTextContent("目前沒有可收款的活動");
  });

  it("shows an error message when collection data cannot be loaded", async () => {
    api.listClassOrders.mockRejectedValue(new Error("service unavailable"));
    api.catalog.mockResolvedValue([]);
    render(<ClassOrdersPage />);

    openCollectWorkspace();
    expect(await screen.findByText(/無法載入活動與座號收款資料/)).toHaveAttribute("role", "alert");
  });

  it("applies a searched product and variant to multiple classmates", async () => {
    render(<ClassOrdersPage />);
    fireEvent.click(screen.getByRole("button", { name: "批次給多人" }));
    await screen.findByRole("checkbox", { name: /1 號/ });
    fireEvent.click(screen.getByRole("button", { name: "選取顯示的 2 位" }));
    await chooseProduct("shirt");
    fireEvent.change(screen.getByRole("spinbutton", { name: "每位數量" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /加入清單，繼續選商品/ }));

    expect(screen.getByRole("heading", { name: "2 位同學的商品清單" })).toBeVisible();
    expect(screen.getByText("每人 NT$400 · 2 位合計 NT$800")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "送出2 位同學的訂單 · 小計 NT$800" }));

    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledTimes(2));
    expect(api.createClassOrder.mock.calls.map(([body]) => body)).toEqual([
      { user_id: "a", notes: null, items: [{ product_id: "shirt", quantity: 2, option_ids: ["medium"] }] },
      { user_id: "b", notes: null, items: [{ product_id: "shirt", quantity: 2, option_ids: ["medium"] }] },
    ]);
  });

  it("searches within a product that has many specifications", async () => {
    render(<ClassOrdersPage />);
    fireEvent.click(screen.getByRole("button", { name: "批次給多人" }));
    await screen.findByRole("checkbox", { name: /1 號/ });
    fireEvent.click(screen.getByRole("button", { name: "選取顯示的 2 位" }));
    const productSearch = screen.getByRole("searchbox", { name: "搜尋商品" });
    fireEvent.change(productSearch, { target: { value: "徽章" } });
    fireEvent.click(await screen.findByRole("button", { name: /紀念徽章/ }));

    const variantSearch = await screen.findByRole("searchbox", { name: "搜尋顏色" });
    expect(variantSearch).toHaveAttribute("placeholder", "搜尋顏色（30 個規格）");
    fireEvent.change(variantSearch, { target: { value: "色票30" } });
    fireEvent.click(await screen.findByRole("radio", { name: "色票30" }));

    expect(screen.getByRole("button", { name: /加入清單，繼續選商品/ })).toBeEnabled();
  });

  it("builds a multi-product order for one student with merged quantities and the chosen variant", async () => {
    render(<ClassOrdersPage />);
    openOrderWorkspace();
    expect(screen.getByRole("searchbox", { name: "搜尋商品" })).toBeDisabled();
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
    openOrderWorkspace();
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
    openOrderWorkspace();
    await chooseStudent();
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: "依活動與座號收款" }));
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
    openCollectWorkspace();
    await screen.findByRole("option", { name: "園遊會" });
    fireEvent.change(screen.getByRole("combobox", { name: "收款活動" }), { target: { value: "none" } });
    fireEvent.click(screen.getAllByRole("button", { name: "設為已收" }).find((button) => !button.hasAttribute("disabled"))!);
    await waitFor(() => expect(api.setClassCollected).toHaveBeenCalledTimes(1));
    expect(api.setClassCollected).toHaveBeenCalledWith("one", true);
  });

  it("shows merged items and the supplemental amount, and collects only additions in this activity", async () => {
    const item = { id: "bag", product_id: "product", product_name: "紀念袋", quantity: 1,
      unit_price: 100, subtotal: 100, selected_options: [] };
    api.listClassOrders.mockResolvedValue([
      { id: "collected", user_id: "a", status: "pending", total_price: 200,
        activity_id: null, category_id: "category", is_class_collected: true,
        items: [{ ...item, quantity: 2, subtotal: 200 }] },
      { id: "addition", user_id: "a", status: "pending", total_price: 100,
        activity_id: null, category_id: "category", is_class_collected: false, items: [item] },
      { id: "cancelled", user_id: "a", status: "cancelled", total_price: 500,
        activity_id: null, category_id: "category", is_class_collected: false, items: [item] },
      { id: "other", user_id: "a", status: "pending", total_price: 300,
        activity_id: "other", is_class_collected: false, items: [item] },
    ]);
    api.setClassCollected.mockResolvedValue({});
    render(<ClassOrdersPage />);
    openCollectWorkspace();
    await screen.findByRole("option", { name: "園遊會" });
    fireEvent.change(screen.getByRole("combobox", { name: "收款活動" }), { target: { value: "category:category" } });
    await screen.findAllByText("紀念袋 × 3");
    fireEvent.click(screen.getAllByRole("button", { name: "補收 NT$100" })[0]);
    await waitFor(() => expect(api.setClassCollected).toHaveBeenCalledTimes(1));
    expect(api.setClassCollected).toHaveBeenCalledWith("addition", true);
  });
});
