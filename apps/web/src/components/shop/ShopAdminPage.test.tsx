import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopAdminPage from "@/app/(protected)/shop/admin/page";

const api = vi.hoisted(() => ({
  listCategories: vi.fn(), listProducts: vi.fn(), listActivities: vi.fn(),
  list: vi.fn(), recipientOptions: vi.fn(), orderSummary: vi.fn(),
  listSeries: vi.fn(), createProduct: vi.fn(), getProduct: vi.fn(),
  testProduct: vi.fn(), activateProduct: vi.fn(), updateProduct: vi.fn(), uploadImage: vi.fn(),
  getProductPurchaseRules: vi.fn(), purchasePermissions: vi.fn(), purchaseGroupOptions: vi.fn(),
  getProductCost: vi.fn(),
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
  api.getProductCost.mockResolvedValue({ unit_cost: 60 });
  api.getProductPurchaseRules.mockResolvedValue({ allowed_grades: [], required_permissions: [], allowed_identifiers: [], blocked_identifiers: [], exclusive_group: null, designated_only: false });
  api.purchasePermissions.mockResolvedValue([]);
  api.purchaseGroupOptions.mockResolvedValue([]);
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

it("成本讀取失敗會停用儲存，重試後可清空成本", async () => {
  const product = { id: "cost-product", category_id: "cost-cat", name: "成本商品", price: 100,
    stock_quantity: 20, status: "active", variant_groups: [] };
  api.listCategories.mockResolvedValue([{ id: "cost-cat", name: "成本測試" }]);
  api.listProducts.mockResolvedValue([product]);
  api.getProductCost.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ unit_cost: 60 });
  api.updateProduct.mockResolvedValue(product);
  api.getProduct.mockResolvedValue(product);
  render(<ShopAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: /成本測試/ }));
  fireEvent.click((await screen.findAllByRole("button", { name: "編輯" }))[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("成本讀取失敗");
  expect(screen.getByRole("button", { name: "儲存商品" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新讀取成本" }));
  const input = screen.getByRole("spinbutton", { name: "內部單位成本（新台幣元，選填）" });
  await waitFor(() => expect(input).toHaveValue(60));
  fireEvent.change(input, { target: { value: "-1" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存商品" }));
  expect(screen.getByRole("alert")).toHaveTextContent("成本請填寫");
  expect(input).toHaveFocus();
  expect(api.updateProduct).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存商品" }));
  await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("cost-product", expect.objectContaining({ unit_cost: null })));
});

describe("商品管理與統計", () => {
  it("檢查原價與售價後送出，儲存失敗仍保留原價", async () => {
    api.listCategories.mockResolvedValue([{ id: "category", name: "校慶商品", is_active: true }]);
    api.createProduct.mockRejectedValueOnce(new Error("offline"));
    render(<ShopAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: /校慶商品/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "新增單一商品" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "商品名稱" }), { target: { value: "紀念衫" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "售價（新台幣元）" }), { target: { value: "300" } });
    const original = screen.getByRole("spinbutton", { name: "原價（新台幣元，選填）" });
    fireEvent.change(original, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("原價請填寫不低於售價的整數");
    expect(original).toHaveFocus();
    expect(api.createProduct).not.toHaveBeenCalled();
    fireEvent.change(original, { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("商品尚未儲存，請重試");
    expect(original).toHaveValue(400);
    expect(api.createProduct).toHaveBeenCalledWith(expect.objectContaining({ price: 300, original_price: 400 }));
    fireEvent.change(original, { target: { value: "" } });
    api.createProduct.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    await waitFor(() => expect(api.createProduct).toHaveBeenLastCalledWith(expect.objectContaining({ original_price: null })));
  });
  it("以直接入口取代商品頁的活動期限區塊", async () => {
    render(<ShopAdminPage />);
    await screen.findByText(/尚未建立商品主題/);
    expect(screen.getByRole("link", { name: "活動鎖單" })).toHaveAttribute("href", "/shop/council-orders#activity-order-closure-title");
    expect(screen.queryByText("活動結單與期限")).not.toBeInTheDocument();
    expect(screen.queryByText(/目前沒有可設定的活動/)).not.toBeInTheDocument();
    expect(api.listActivities).not.toHaveBeenCalled();
  });

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
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("售價請填寫 0 或正整數");
    expect(price).toHaveFocus();
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(price).toHaveAccessibleDescription("售價請填寫 0 或正整數，單位為新台幣元。");
    expect(api.createProduct).not.toHaveBeenCalled();
    fireEvent.change(price, { target: { value: "100" } });
    const stock = screen.getByRole("spinbutton", { name: "可訂購數量（件）" });
    fireEvent.change(stock, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("可訂購數量請填寫 0 或正整數");
    expect(api.createProduct).not.toHaveBeenCalled();
    fireEvent.change(stock, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("商品尚未儲存，請重試");
    expect(screen.getByRole("textbox", { name: "商品名稱" })).toHaveValue("紀念袋");
    expect(price).toHaveValue(100);
    expect(stock).toHaveValue(50);
    expect(api.createProduct).toHaveBeenCalledWith(expect.objectContaining({ price: 100, stock_quantity: 50 }));
  });

  it("直接從新增入口選主題，一次儲存商品與批次規格後上架", async () => {
    api.listCategories.mockResolvedValue([{ id: "first", name: "校慶" }, { id: "second", name: "畢業季" }]);
    const draft = { id: "new", category_id: "second", name: "畢業紀念衫", price: 300, stock_quantity: 50, status: "draft", variant_groups: [] };
    api.createProduct.mockResolvedValue(draft);
    api.activateProduct.mockResolvedValue({ ...draft, status: "active" });
    api.getProduct.mockResolvedValue({ ...draft, status: "active" });
    render(<ShopAdminPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "新增商品" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "新增商品" }));
    fireEvent.change(screen.getByRole("combobox", { name: "商品主題" }), { target: { value: "second" } });
    fireEvent.change(screen.getByRole("textbox", { name: "商品名稱" }), { target: { value: "畢業紀念衫" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "售價（新台幣元）" }), { target: { value: "300" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "可訂購數量（件）" }), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "加入尺寸" }));
    fireEvent.change(screen.getByRole("textbox", { name: "規格 1 選項（逗號或換行分隔）" }), { target: { value: "S, M, M, XL:50" } });
    fireEvent.click(screen.getByRole("button", { name: "加入顏色" }));
    fireEvent.change(screen.getByRole("textbox", { name: "規格 2 選項（逗號或換行分隔）" }), { target: { value: "黑\n白" } });
    fireEvent.click(screen.getByRole("button", { name: "建立並上架" }));
    await waitFor(() => expect(api.activateProduct).toHaveBeenCalledWith("new"));
    expect(api.createProduct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      category_id: "second", series_id: null, name: "畢業紀念衫", price: 300, stock_quantity: 50,
      variant_groups: [
        { name: "尺寸", sort_order: 0, options: [
          { value: "S", price_delta: 0, image_url: null, sort_order: 0 },
          { value: "M", price_delta: 0, image_url: null, sort_order: 1 },
          { value: "XL", price_delta: 50, image_url: null, sort_order: 2 },
        ] },
        { name: "顏色", sort_order: 1, options: [
          { value: "黑", price_delta: 0, image_url: null, sort_order: 0 },
          { value: "白", price_delta: 0, image_url: null, sort_order: 1 },
        ] },
      ],
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新增商品" })).not.toBeInTheDocument());
  });

  it.each([false, true])("上架失敗保留草稿，重試不重複建立商品（伺服器已上架：%s）", async (alreadyActive) => {
    const draft = { id: "new", category_id: "cat", name: "紀念袋", price: 100, status: "draft", variant_groups: [] };
    api.listCategories.mockResolvedValue([{ id: "cat", name: "校慶" }]);
    api.createProduct.mockResolvedValue(draft);
    api.getProduct.mockResolvedValue({ ...draft, status: alreadyActive ? "active" : "draft" });
    api.activateProduct.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...draft, status: "active" });
    render(<ShopAdminPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "新增商品" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "新增商品" }));
    fireEvent.change(screen.getByRole("textbox", { name: "商品名稱" }), { target: { value: "紀念袋" } });
    fireEvent.click(screen.getByRole("button", { name: "建立並上架" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已儲存");
    expect(screen.getByRole("button", { name: "保留草稿並關閉" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重試上架" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新增商品" })).not.toBeInTheDocument());
    expect(api.createProduct).toHaveBeenCalledTimes(1);
    expect(api.activateProduct).toHaveBeenCalledTimes(alreadyActive ? 1 : 2);
  });

  it("規格未填完整時聚焦提示，建立失敗保留規格供重試；草稿不自動上架", async () => {
    api.listCategories.mockResolvedValue([{ id: "cat", name: "校慶" }]);
    api.createProduct.mockRejectedValueOnce(new Error("offline"));
    render(<ShopAdminPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "新增商品" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "新增商品" }));
    fireEvent.change(screen.getByRole("textbox", { name: "商品名稱" }), { target: { value: "紀念衫" } });
    fireEvent.click(screen.getByRole("button", { name: "加入尺寸" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("請填寫每組規格名稱與至少一個選項");
    expect(screen.getByLabelText("商品規格")).toHaveFocus();
    expect(api.createProduct).not.toHaveBeenCalled();
    const options = screen.getByRole("textbox", { name: "規格 1 選項（逗號或換行分隔）" });
    fireEvent.change(options, { target: { value: "S, M" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("商品尚未儲存");
    expect(options).toHaveValue("S, M");
    expect(api.activateProduct).not.toHaveBeenCalled();
  });

  it("收合的限購設定無效時會自動展開並聚焦，編輯保留原本的選填資料", async () => {
    const product = { id: "old", category_id: "cat", name: "紀念袋", price: 100, stock_quantity: 20,
      description: "原本描述", max_quantity_per_user: 2, requires_seating: false, status: "draft", variant_groups: [] };
    api.listCategories.mockResolvedValue([{ id: "cat", name: "校慶" }]);
    api.listProducts.mockResolvedValue([product]);
    api.updateProduct.mockRejectedValue(new Error("offline"));
    render(<ShopAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: /校慶/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "編輯" }))[0]);
    await screen.findByText("購買資格");
    const limit = screen.getByLabelText("每人限購數量（留空表示不限購）");
    expect(limit).toHaveValue(2);
    fireEvent.change(limit, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存商品" }));
    await waitFor(() => expect(limit).toHaveFocus());
    expect(limit.closest("details")).toHaveAttribute("open");
    fireEvent.change(limit, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存商品" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("old", expect.objectContaining({ description: "原本描述", max_quantity_per_user: 3 })));
    expect(api.activateProduct).not.toHaveBeenCalled();
  });

  it("照片上傳完成前禁止儲存，完成後可連同主圖儲存草稿", async () => {
    const draft = { id: "photo", category_id: "cat", name: "紀念袋", price: 0, stock_quantity: 0, status: "draft", variant_groups: [] };
    api.listCategories.mockResolvedValue([{ id: "cat", name: "校慶" }]);
    api.createProduct.mockResolvedValue(draft);
    api.getProduct.mockResolvedValue(draft);
    let finishUpload!: (result: { url: string }) => void;
    api.uploadImage.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    render(<ShopAdminPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "新增商品" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "新增商品" }));
    fireEvent.change(screen.getByRole("textbox", { name: "商品名稱" }), { target: { value: "紀念袋" } });
    fireEvent.change(screen.getByLabelText("一次選取多張商品照片"), { target: { files: [new File(["photo"], "bag.png", { type: "image/png" })] } });
    expect(screen.getByRole("button", { name: "儲存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "照片上傳中…" })).toBeDisabled();
    await act(async () => finishUpload({ url: "/uploads/bag.png" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith(expect.objectContaining({ image_url: "/uploads/bag.png", variant_groups: [] })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.activateProduct).not.toHaveBeenCalled();
  });
});

it("購買資格讀取失敗時不允許儲存，重試後保留名單再送出", async () => {
  const product = { id: "rules-product", category_id: "rules-cat", name: "高三票", price: 100,
    stock_quantity: 20, status: "active", variant_groups: [] };
  api.listCategories.mockResolvedValue([{ id: "rules-cat", name: "購買資格測試" }]);
  api.listProducts.mockResolvedValue([product]);
  api.getProductPurchaseRules.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
    allowed_grades: [3], blocked_identifiers: ["310002"], required_permissions: [], allowed_identifiers: [],
    exclusive_group: "校慶", designated_only: false,
  });
  api.updateProduct.mockResolvedValue(product);
  api.getProduct.mockResolvedValue(product);
  render(<ShopAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: /購買資格測試/ }));
  fireEvent.click((await screen.findAllByRole("button", { name: "編輯" }))[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("購買資格讀取失敗");
  expect(screen.getByRole("button", { name: "儲存商品" })).toBeDisabled();
  expect(api.updateProduct).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新讀取購買資格" }));
  expect(await screen.findByLabelText("高三")).toBeChecked();
  expect(screen.getByLabelText("禁止購買名單")).toHaveValue("310002");
  fireEvent.click(screen.getByRole("button", { name: "儲存商品" }));
  await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("rules-product", expect.objectContaining({
    purchase_rules: expect.objectContaining({ allowed_grades: [3], blocked_identifiers: ["310002"], exclusive_group: "校慶" }),
  })));
});
