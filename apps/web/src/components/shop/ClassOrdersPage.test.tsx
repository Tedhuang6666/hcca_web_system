import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassOrdersPage from "@/app/(protected)/shop/class-orders/page";

const api = vi.hoisted(() => ({
  listClassOrders: vi.fn(), classSummary: vi.fn(), catalog: vi.fn(), getCloseStatus: vi.fn(),
  getProduct: vi.fn(), getOrder: vi.fn(), updateOrder: vi.fn(), createClassOrder: vi.fn(), myClass: vi.fn(), members: vi.fn(),
  setClassCollected: vi.fn(), closeCategory: vi.fn(), reopenCategory: vi.fn(),
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
  api.closeCategory.mockResolvedValue({});
  api.reopenCategory.mockResolvedValue({});
});

async function chooseStudent(id = "a") {
  const singleMode = screen.getByRole("button", { name: "逐位代訂" });
  if (singleMode.getAttribute("aria-pressed") !== "true") fireEvent.click(singleMode);
  const roster = await screen.findByRole("group", { name: "同學搜尋結果" });
  fireEvent.click(await within(roster).findByRole("button", { name: id === "a" ? /1 號.*示範甲/ : /2 號.*示範乙/ }));
}

async function chooseProduct(id = "product") {
  const change = screen.queryByRole("button", { name: "換商品" });
  if (change) fireEvent.click(change);
  const search = screen.getByRole("searchbox", { name: "搜尋商品" });
  const productName = id === "shirt" ? /紀念衫/ : /紀念袋/;
  const results = screen.getByRole("group", { name: "商品搜尋結果" });
  fireEvent.change(search, { target: { value: id === "shirt" ? "紀念衫" : "紀念袋" } });
  fireEvent.click(await within(results).findByRole("button", { name: productName }));
  if (id === "shirt") fireEvent.click(await screen.findByRole("radio", { name: "M" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /加入清單，繼續選商品/ })).toBeEnabled());
}

function taskSwitch() {
  return screen.getByRole("navigation", { name: "班代工作" });
}

function openOrderWorkspace() {
  fireEvent.click(within(taskSwitch()).getByRole("button", { name: "代訂" }));
}

function openCollectWorkspace() {
  fireEvent.click(within(taskSwitch()).getByRole("button", { name: "確認收款" }));
}

describe("班代工作流程", () => {
  it("主切換列直接提供班級截止，可設定時間與立即截止", async () => {
    render(<ClassOrdersPage />);
    const entry = within(taskSwitch()).getByRole("button", { name: "班級截止" });
    expect(entry).toBeVisible();
    fireEvent.click(entry);
    const settings = await screen.findByRole("region", { name: "班級截止設定" });
    expect(settings).toBeVisible();
    const input = await within(settings).findByLabelText(/班級截止時間（台北時間）/);
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "2030-10-29T18:00" } });
    fireEvent.click(within(settings).getByRole("button", { name: "儲存班級截止時間" }));
    await waitFor(() => expect(api.closeCategory).toHaveBeenCalledWith("category", {
      class_id: "class", closes_at: "2030-10-29T10:00:00.000Z",
    }));
    await waitFor(() => expect(within(settings).getByRole("button", { name: "立即截止本班" })).toBeEnabled());
    fireEvent.click(within(settings).getByRole("button", { name: "立即截止本班" }));
    await waitFor(() => expect(api.closeCategory).toHaveBeenCalledWith("category", {
      class_id: "class", closes_at: null,
    }));
  });

  it("截止設定載入中仍顯示入口與載入狀態", () => {
    api.catalog.mockImplementationOnce(() => new Promise(() => {}));
    render(<ClassOrdersPage />);
    fireEvent.click(within(taskSwitch()).getByRole("button", { name: "班級截止" }));
    const settings = screen.getByRole("region", { name: "班級截止設定" });
    expect(within(settings).getByRole("status")).toHaveTextContent("正在載入班級截止設定");
    expect(within(settings).queryByText("目前沒有可設定截止時間的活動或商品。")).not.toBeInTheDocument();
  });

  it("截止設定載入失敗能重試，空目錄也有說明", async () => {
    api.catalog.mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce([]);
    render(<ClassOrdersPage />);
    fireEvent.click(within(taskSwitch()).getByRole("button", { name: "班級截止" }));
    const settings = screen.getByRole("region", { name: "班級截止設定" });
    expect(await within(settings).findByRole("alert")).toHaveTextContent("無法載入班級截止設定");
    fireEvent.click(within(settings).getByRole("button", { name: "重新載入截止設定" }));
    expect(await within(settings).findByText("目前沒有可設定截止時間的活動或商品。")).toBeVisible();
    expect(api.catalog).toHaveBeenCalledTimes(2);
  });

  it("已結單活動保留收款名冊與收款操作", async () => {
    api.catalog.mockResolvedValue([{ id: "category", name: "園遊會", activity_id: "festival",
      activity_name: "園遊會", order_closed_at: "2026-10-27T12:00:00Z", series: [], products: [] }]);
    api.listClassOrders.mockResolvedValue([
      { id: "closed-order", serial_number: "1", user_id: "a", status: "pending", total_price: 100,
        activity_id: "festival", is_class_collected: false, items: [] },
    ]);
    api.setClassCollected.mockResolvedValue({});
    render(<ClassOrdersPage />);
    openCollectWorkspace();
    const table = await screen.findByRole("table", { name: "園遊會各座號收款" });
    const collect = within(table).getAllByRole("button", { name: "設為已收" })
      .find((button) => !button.hasAttribute("disabled"))!;
    fireEvent.click(collect);
    await waitFor(() => expect(api.setClassCollected).toHaveBeenCalledWith("closed-order", true));
    expect(api.catalog).toHaveBeenCalledWith(undefined, true);
  });

  it("代訂與清單數量都能先刪空再輸入，並送出實際填寫的數量", async () => {
    const user = userEvent.setup();
    render(<ClassOrdersPage />);
    await chooseStudent();
    await chooseProduct();
    const quantity = screen.getByRole("spinbutton", { name: /^數量$/ });

    await user.clear(quantity);
    expect(quantity).toHaveValue(null);
    await user.type(quantity, "8");
    expect(quantity).toHaveValue(8);
    await user.click(screen.getByRole("button", { name: /加入清單，繼續選商品/ }));

    const itemQuantity = screen.getByRole("spinbutton", { name: "紀念袋數量" });
    await user.clear(itemQuantity);
    expect(itemQuantity).toHaveValue(null);
    await user.type(itemQuantity, "6");
    expect(itemQuantity).toHaveValue(6);
    await user.click(screen.getByRole("button", { name: "送出示範甲的訂單 · 小計 NT$600" }));

    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledWith({
      user_id: "a", notes: null, items: [{ product_id: "product", quantity: 6, option_ids: [] }],
    }));
  });

  it("主要切換列提供代訂、確認收款與班級截止", async () => {
    render(<ClassOrdersPage />);

    const navigation = taskSwitch();
    expect(within(navigation).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "代訂", "確認收款", "班級截止",
    ]);
    fireEvent.click(within(navigation).getByRole("button", { name: "確認收款" }));
    expect(await screen.findByRole("heading", { name: "確認收款" })).toBeVisible();
  });

  it("shows the roster first and clears the current items before changing classmates", async () => {
    render(<ClassOrdersPage />);
    expect(screen.queryByRole("searchbox", { name: "搜尋商品" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /送出.*訂單/ })).not.toBeInTheDocument();
    await chooseStudent();
    expect(screen.queryByRole("group", { name: "同學搜尋結果" })).not.toBeInTheDocument();
    await chooseProduct("shirt");
    expect(screen.queryByRole("group", { name: "商品搜尋結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "備註", hidden: true })).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "清空並重選同學" }));
    await chooseStudent("b");
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /送出示範乙的訂單/ }));
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledWith({
      user_id: "b", notes: null, items: [{ product_id: "product", quantity: 1, option_ids: [] }],
    }));
  });

  it("recovers from a product detail error without losing the chosen classmate", async () => {
    api.getProduct.mockRejectedValueOnce(new Error("unavailable"));
    render(<ClassOrdersPage />);
    await chooseStudent();
    fireEvent.click(screen.getByRole("button", { name: /紀念袋.*NT/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入商品規格");
    await chooseProduct();
    expect(screen.getByRole("button", { name: /送出示範甲的訂單/ })).toBeEnabled();
  });

  it("reloads the roster after a first order so collection stays on the same seat", async () => {
    api.members.mockResolvedValue([
      { id: "roster-member", user_id: null, roster_entry_id: "seat-7", display_name: "未登入同學", seat_number: 7 },
    ]);
    api.createClassOrder.mockImplementation(async () => {
      api.members.mockResolvedValue([
        { id: "new-user", user_id: "new-user", roster_entry_id: "seat-7", display_name: "未登入同學", seat_number: 7 },
      ]);
      api.listClassOrders.mockResolvedValue([{
        id: "first-order", user_id: "new-user", user_name: "未登入同學", status: "pending",
        category_id: "category", activity_id: null, total_price: 100,
        is_paid: false, is_class_collected: false, items: [],
      }]);
      return [];
    });
    render(<ClassOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: /7 號.*未登入同學/ }));
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /送出.*訂單/ }));
    await screen.findByText(/已完成 1 位同學的訂購/);
    await waitFor(() => expect(api.members).toHaveBeenCalledTimes(2));
    openCollectWorkspace();
    const table = await screen.findByRole("table", { name: "園遊會各座號收款" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("7 號");
    expect(within(rows[0]).getByRole("button", { name: "設為已收" })).toBeEnabled();
  });

  it("retries a failed roster load using refresh", async () => {
    api.members.mockRejectedValueOnce(new Error("roster unavailable"));
    render(<ClassOrdersPage />);
    await screen.findByText("無法載入本班名冊，請重新整理後再試。");
    expect(screen.getByRole("searchbox", { name: "搜尋同學" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(await screen.findByRole("button", { name: /1 號.*示範甲/ })).toBeEnabled();
  });

  it("finds an unregistered classmate by seat and submits their roster entry", async () => {
    api.members.mockResolvedValue([
      { id: "roster-member", user_id: null, roster_entry_id: "seat-7", display_name: "尚未登入同學", seat_number: 7 },
      { id: "a", user_id: "a", display_name: "示範甲", seat_number: 1 },
    ]);
    render(<ClassOrdersPage />);
    const search = await screen.findByRole("searchbox", { name: "搜尋同學" });
    await screen.findByRole("button", { name: /7 號.*尚未登入同學/ });
    fireEvent.change(search, { target: { value: "7" } });
    fireEvent.click(within(screen.getByRole("group", { name: "同學搜尋結果" })).getByRole("button", { name: /7 號/ }));
    expect(screen.getByRole("region", { name: "訂購同學" })).toHaveTextContent("尚未登入同學");
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /送出.*訂單/ }));
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledWith({
      roster_entry_id: "seat-7", notes: null,
      items: [{ product_id: "product", quantity: 1, option_ids: [] }],
    }));
  });

  it("submits a mixed batch with both roster entries and registered accounts", async () => {
    api.members.mockResolvedValue([
      { id: "a", user_id: "a", display_name: "示範甲", seat_number: 1 },
      { id: "r", user_id: null, roster_entry_id: "seat-2", display_name: "未登入同學", seat_number: 2 },
    ]);
    render(<ClassOrdersPage />);
    fireEvent.click(screen.getByRole("button", { name: "批次給多人" }));
    await screen.findByRole("checkbox", { name: /2 號/ });
    fireEvent.click(screen.getByRole("button", { name: "選取顯示的 2 位" }));
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /送出.*訂單/ }));
    await waitFor(() => expect(api.createClassOrder).toHaveBeenCalledTimes(2));
    expect(api.createClassOrder.mock.calls.map(([body]) => body)).toEqual([
      { user_id: "a", notes: null, items: [{ product_id: "product", quantity: 1, option_ids: [] }] },
      { roster_entry_id: "seat-2", notes: null, items: [{ product_id: "product", quantity: 1, option_ids: [] }] },
    ]);
  });

  it("opens single-student ordering first, then sorts the collection roster by seat number", async () => {
    api.members.mockResolvedValue([
      { id: "b", display_name: "示範乙", seat_number: 2 },
      { id: "a", display_name: "示範甲", seat_number: 1 },
    ]);
    render(<ClassOrdersPage />);

    expect(within(taskSwitch()).getByRole("button", { name: "代訂" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "逐位代訂" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "批次給多人" })).toHaveAttribute("aria-pressed", "false");
    openCollectWorkspace();
    const table = await screen.findByRole("table", { name: "園遊會各座號收款" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["1 號", "2 號"]);
    expect(within(table).queryByRole("columnheader", { name: "訂單" })).not.toBeInTheDocument();
  });

  it("shows the selected activity's whole-class due and collected totals regardless of roster filters", async () => {
    api.listClassOrders.mockResolvedValue([
      {
        id: "collected-order", user_id: "a", user_name: "示範甲", status: "pending",
        category_id: "category", activity_id: null, total_price: 150,
        is_paid: false, is_class_collected: true, items: [],
      },
      {
        id: "uncollected-order", user_id: "b", user_name: "示範乙", status: "pending",
        category_id: "category", activity_id: null, total_price: 250,
        is_paid: false, is_class_collected: false, items: [],
      },
      {
        id: "cancelled-order", user_id: "a", user_name: "示範甲", status: "cancelled",
        category_id: "category", activity_id: null, total_price: 50,
        is_paid: false, is_class_collected: false, items: [],
      },
      {
        id: "refunded-order", user_id: "b", user_name: "示範乙", status: "refunded",
        category_id: "category", activity_id: null, total_price: 70,
        is_paid: false, is_class_collected: false, items: [],
      },
    ]);
    render(<ClassOrdersPage />);

    openCollectWorkspace();
    const totals = await screen.findByRole("group", { name: "全班收款統計" });
    expect(within(totals).getByText("全班應收").parentElement?.textContent).toContain("NT$400");
    expect(within(totals).getByText("班代目前已收").parentElement?.textContent).toContain("NT$150");

    fireEvent.change(screen.getByRole("textbox", { name: "搜尋收款同學" }), {
      target: { value: "示範甲" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "名冊收款狀態" }), {
      target: { value: "paid" },
    });

    expect(within(totals).getByText("全班應收").parentElement?.textContent).toContain("NT$400");
    expect(within(totals).getByText("班代目前已收").parentElement?.textContent).toContain("NT$150");
  });

  it("shows a clear message when there are no activities to collect", async () => {
    api.catalog.mockResolvedValue([]);
    render(<ClassOrdersPage />);

    openCollectWorkspace();
    expect(await screen.findByRole("status")).toHaveTextContent("目前沒有可收款的活動");
  });

  it("keeps existing items when adding another product to an assisted order", async () => {
    const order = {
      id: "assisted-order", serial_number: "ORD-1", user_id: "a", user_name: "示範甲",
      status: "pending", total_price: 200, category_id: "category", activity_id: null,
      assistance_scope: "class_assisted", is_paid: false, is_class_collected: false,
      items: [{ id: "bag", product_id: "product", product_name: "紀念袋", quantity: 2,
        unit_price: 100, subtotal: 200, selected_options: [] }],
    };
    api.listClassOrders.mockResolvedValue([order]);
    api.getOrder.mockResolvedValue(order);
    api.updateOrder.mockResolvedValue(order);
    render(<ClassOrdersPage />);
    fireEvent.click(screen.getByRole("button", { name: "查詢／修改訂單" }));
    const edit = await screen.findByTitle("修改訂單");
    expect(edit).toBeVisible();
    fireEvent.click(edit);
    await screen.findByRole("spinbutton", { name: "紀念袋數量" });
    expect(screen.queryByRole("group", { name: "加入商品與規格" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增商品" }));
    await chooseProduct("shirt");
    fireEvent.click(screen.getByRole("button", { name: "儲存修改 · 小計 NT$400" }));
    await waitFor(() => expect(api.updateOrder).toHaveBeenCalledWith("assisted-order", {
      user_id: "a", notes: null, items: [
        { product_id: "product", quantity: 2, option_ids: [] },
        { product_id: "shirt", quantity: 1, option_ids: ["medium"] },
      ],
    }));
  });

  it("lists non-cancelled class orders by seat number", async () => {
    api.members.mockResolvedValue([
      { id: "student-12", display_name: "十二號同學", seat_number: 12 },
      { id: "student-2", display_name: "二號同學", seat_number: 2 },
      { id: "student-unseated", display_name: "未編座號同學", seat_number: null },
    ]);
    api.listClassOrders.mockResolvedValue([
      { id: "order-12", serial_number: "ORD-12", user_id: "student-12", user_name: "十二號同學",
        status: "pending", total_price: 100, is_class_collected: false },
      { id: "cancelled-order", serial_number: "ORD-CANCELLED", user_id: "student-2",
        user_name: "二號同學", status: "cancelled", total_price: 100, is_class_collected: false },
      { id: "order-2", serial_number: "ORD-2", user_id: "student-2", user_name: "二號同學",
        status: "pending", total_price: 100, is_class_collected: false },
      { id: "refunded-order", serial_number: "ORD-2-REFUNDED", user_id: "student-2",
        user_name: "二號同學", status: "refunded", total_price: 100, is_class_collected: false },
      { id: "unseated-order", serial_number: "ORD-UNSEATED", user_id: "student-unseated",
        user_name: "未編座號同學", status: "pending", total_price: 100, is_class_collected: false },
    ]);
    render(<ClassOrdersPage />);
    fireEvent.click(screen.getByRole("button", { name: "查詢／修改訂單" }));

    await screen.findAllByRole("link", { name: "ORD-2" });
    const table = screen.getAllByRole("table").find((candidate) =>
      within(candidate).queryByRole("link", { name: "ORD-2" }),
    )!;
    expect(within(table).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "ORD-2", "ORD-2-REFUNDED", "ORD-12", "ORD-UNSEATED",
    ]);
    expect(screen.queryByText("ORD-CANCELLED")).not.toBeInTheDocument();
    expect(screen.getByText("4 筆")).toBeInTheDocument();
  });

  it("defaults collection to the activity with the most uncollected orders", async () => {
    api.catalog.mockResolvedValue([
      { id: "empty-category", name: "空活動", activity_id: "empty", series: [], products: [] },
      { id: "busy-category", name: "待收活動", activity_id: "busy", series: [], products: [
        { id: "busy-product", name: "活動商品", status: "active", price: 100 },
      ] },
    ]);
    api.listClassOrders.mockResolvedValue([
      { id: "busy-one", user_id: "a", status: "pending", activity_id: "busy", category_id: "busy-category", activity_name: "待收活動", total_price: 100, is_class_collected: false },
      { id: "busy-two", user_id: "b", status: "pending", activity_id: "busy", category_id: "busy-category", activity_name: "待收活動", total_price: 100, is_class_collected: false },
    ]);
    render(<ClassOrdersPage />);

    openCollectWorkspace();
    const activitySelect = await screen.findByRole("combobox", { name: "收款活動" });
    await waitFor(() => expect(activitySelect).toHaveValue("busy"));
    expect(within(activitySelect).getByRole("option", { name: "空活動" })).toBeInTheDocument();

    fireEvent.change(activitySelect, { target: { value: "empty" } });
    expect(activitySelect).toHaveValue("empty");
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
    expect(screen.queryByRole("searchbox", { name: "搜尋商品" })).not.toBeInTheDocument();
    await chooseStudent();
    await chooseProduct();
    fireEvent.click(screen.getByRole("button", { name: /加入清單，繼續選商品/ }));
    expect(screen.getByRole("region", { name: "訂購同學" })).toHaveTextContent("示範甲");
    expect(screen.getByRole("button", { name: "清空並重選同學" })).toBeEnabled();
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
    expect(screen.getByRole("searchbox", { name: "搜尋同學" })).toHaveValue("");
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
    openCollectWorkspace();
    expect(screen.queryByRole("combobox", { name: "商品" })).not.toBeInTheDocument();
    openOrderWorkspace();
    expect(screen.getByRole("region", { name: "訂購同學" })).toHaveTextContent("示範甲");
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
    const collectButtons = await screen.findAllByRole("button", { name: "設為已收" });
    fireEvent.click(collectButtons.find((button) => !button.hasAttribute("disabled"))!);
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
