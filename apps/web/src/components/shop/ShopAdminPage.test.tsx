import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopAdminPage from "@/app/(protected)/shop/admin/page";

const api = vi.hoisted(() => ({
  listCategories: vi.fn(), listProducts: vi.fn(), listActivities: vi.fn(),
  list: vi.fn(), recipientOptions: vi.fn(), orderSummary: vi.fn(),
  listSeries: vi.fn(), createProduct: vi.fn(), getProduct: vi.fn(),
  testProduct: vi.fn(), activateProduct: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.search) }));
vi.mock("@/lib/api", () => ({ shopApi: api, classApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const summary = (label: string) => ({ group_by: "class", total_amount: 300, paid_amount: 100, unpaid_amount: 200,
  rows: [{ key: label, label, order_count: 1, item_count: 1, total_amount: 300, paid_amount: 100, unpaid_amount: 200 }] });

beforeEach(() => {
  vi.resetAllMocks();
  navigation.search = "";
  api.listCategories.mockResolvedValue([]);
  api.listProducts.mockResolvedValue([]);
  api.list.mockResolvedValue([]);
  api.recipientOptions.mockResolvedValue([]);
  api.listActivities.mockResolvedValue([{ id: "festival", name: "校慶" }, { id: "winter", name: "冬季活動" }]);
  api.orderSummary.mockResolvedValue(summary("初始班級"));
  api.listSeries.mockResolvedValue([]);
});

async function openStats() {
  api.listCategories.mockResolvedValue([
    { id: "shirts", name: "校慶", activity_id: "festival" },
    { id: "bags", name: "袋子", activity_id: "festival" },
    { id: "cards", name: "冬季活動", activity_id: "winter" },
    { id: "general", name: "一般主題", activity_id: null },
  ]);
  navigation.search = "view=stats";
  render(<ShopAdminPage />);
  await screen.findByRole("option", { name: "校慶" });
  await screen.findAllByText("初始班級");
}

describe("商品管理與統計", () => {
  it("starts testing and confirms cleanup before launch, keeping the action available after failure", async () => {
    const product = {
      id: "test-product", category_id: "category", series_id: null, name: "測試限定商品",
      price: 100, stock_quantity: 4, is_unlimited: false, status: "draft",
      image_url: null, variant_groups: [], media: [],
    };
    api.listCategories.mockResolvedValue([{ id: "category", name: "校慶商品", is_active: true }]);
    api.listProducts.mockResolvedValue([product]);
    api.getProduct.mockResolvedValue(product);
    api.testProduct.mockResolvedValue({ ...product, status: "testing" });
    api.activateProduct.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...product, status: "active" });
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ShopAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: /校慶商品/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: /測試限定商品/ }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "開始測試" }));
    await waitFor(() => expect(api.testProduct).toHaveBeenCalledWith("test-product"));
    const launch = await screen.findByRole("button", { name: "正式開放並清除測試資料" });
    fireEvent.click(launch);
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining("測試訂單、付款／收款"));
    expect(api.activateProduct).not.toHaveBeenCalled();
    confirmation.mockReturnValue(true);
    fireEvent.click(launch);
    expect(await screen.findByRole("alert")).toHaveTextContent("商品狀態尚未更新，請重試");
    expect(launch).toBeEnabled();
    fireEvent.click(launch);
    await screen.findByRole("button", { name: "下架" });
    expect(api.activateProduct).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/僅超管或具/)).not.toBeInTheDocument();
    confirmation.mockRestore();
  });
  it("opens statistics from its URL and offers a clear return to product setup", async () => {
    navigation.search = "view=stats";
    const page = render(<ShopAdminPage />);
    expect(screen.getByRole("heading", { name: "訂購統計", level: 1 })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回商品設定" })).toHaveAttribute("href", "/shop/admin");
    expect(screen.getByRole("link", { name: "返回班聯工作" })).toHaveAttribute("href", "/shop/council-orders");
    await screen.findAllByText("初始班級");
    navigation.search = "";
    page.rerender(<ShopAdminPage />);
    expect(screen.getByRole("heading", { name: "商品設定", level: 1 })).toBeVisible();
    expect(screen.getByRole("link", { name: "設定優惠" })).toHaveAttribute("href", "/shop/admin?view=promotions");
    expect(screen.queryByRole("link", { name: "訂購統計" })).not.toBeInTheDocument();
  });

  it("loads products beyond the first page without requesting class-management access", async () => {
    api.list.mockRejectedValue(new Error("requires class:manage"));
    api.listProducts.mockImplementation(({ offset }: { offset: string }) => Promise.resolve(offset === "0"
      ? Array.from({ length: 100 }, (_, index) => ({ id: `product-${index}`, name: `商品 ${index}` }))
      : [{ id: "last", name: "第 101 個商品" }]));
    await openStats();
    fireEvent.click(screen.getByRole("button", { name: "更多篩選" }));
    expect(await screen.findByRole("option", { name: "第 101 個商品" })).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.recipientOptions).toHaveBeenCalled();
  });

  it("keeps the newest activity result when earlier requests finish last", async () => {
    await openStats();
    let resolveOld!: (value: ReturnType<typeof summary>) => void;
    api.orderSummary.mockImplementation((params: { category_id?: string }) => params.category_id === "shirts"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(summary("冬季班級")));
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "cards" } });
    await screen.findAllByText("冬季班級");
    await act(async () => resolveOld(summary("過期班級")));
    expect(screen.queryByText("過期班級")).not.toBeInTheDocument();
    expect(screen.getByText(/統計範圍：冬季活動/)).toBeVisible();
  });

  it("活動選單列出每個主題，並用主題 ID 篩選直屬與系列商品", async () => {
    api.listProducts.mockResolvedValue([
      { id: "shirt", name: "紀念衫", category_id: "shirts" },
      { id: "bag", name: "紀念袋", category_id: null, series_id: "bag-series" },
    ]);
    api.listSeries.mockResolvedValue([{ id: "bag-series", category_id: "bags" }]);
    await openStats();
    const select = screen.getByRole("combobox", { name: "活動" });
    expect(select).toContainElement(screen.getByRole("option", { name: "袋子" }));
    expect(select).toContainElement(screen.getByRole("option", { name: "一般主題" }));
    expect(api.listActivities).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "shirts" } });
    await waitFor(() => expect(api.orderSummary).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "shirts" })));
    expect(api.orderSummary.mock.lastCall?.[0]).not.toHaveProperty("activity_id");
    fireEvent.click(screen.getByRole("button", { name: "更多篩選" }));
    expect(screen.getByRole("option", { name: "紀念衫" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "紀念袋" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "bags" } });
    await waitFor(() => expect(api.orderSummary).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "bags" })));
    expect(screen.getByRole("option", { name: "紀念袋" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "紀念衫" })).not.toBeInTheDocument();
  });

  it("retries failed statistics and clears the activity together with other filters", async () => {
    await openStats();
    api.orderSummary.mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("統計載入失敗");
    fireEvent.click(screen.getByRole("button", { name: "重新載入統計" }));
    await screen.findAllByText("初始班級");
    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    await waitFor(() => expect(api.orderSummary).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "", product_id: "", is_paid: "" })));
    expect(screen.getByRole("combobox", { name: "活動" })).toHaveValue("");
  });

  it("shows a retry instead of claiming a failed catalog is empty", async () => {
    api.listCategories.mockRejectedValueOnce(new Error("offline"));
    render(<ShopAdminPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入商品主題");
    expect(screen.queryByText(/尚未建立商品主題/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新載入商品目錄" }));
    expect(await screen.findByText(/尚未建立商品主題/)).toBeVisible();
  });

  it("rejects invalid amounts and preserves the product form after a failed save", async () => {
    api.listCategories.mockResolvedValue([{ id: "category", name: "校慶商品", is_active: true }]);
    api.createProduct.mockRejectedValueOnce(new Error("offline"));
    render(<ShopAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: /校慶商品/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "新增單一商品" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "商品名稱" }), { target: { value: "紀念袋" } });
    const price = screen.getByRole("spinbutton", { name: "售價（新台幣元）" });
    fireEvent.change(price, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "建立草稿商品" }));
    expect(screen.getByRole("alert")).toHaveTextContent("售價請填寫 0 或正整數");
    expect(price).toHaveFocus();
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(price).toHaveAccessibleDescription("售價請填寫 0 或正整數，單位為新台幣元。");
    expect(api.createProduct).not.toHaveBeenCalled();
    fireEvent.change(price, { target: { value: "100" } });
    const stock = screen.getByRole("spinbutton", { name: "可訂購數量（件）" });
    fireEvent.change(stock, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "建立草稿商品" }));
    expect(screen.getByRole("alert")).toHaveTextContent("可訂購數量請填寫 0 或正整數");
    expect(api.createProduct).not.toHaveBeenCalled();
    fireEvent.change(stock, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "建立草稿商品" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("商品尚未儲存，請重試");
    expect(screen.getByRole("textbox", { name: "商品名稱" })).toHaveValue("紀念袋");
    expect(price).toHaveValue(100);
    expect(stock).toHaveValue(50);
    expect(api.createProduct).toHaveBeenCalledWith(expect.objectContaining({ price: 100, stock_quantity: 50 }));
  });
});
