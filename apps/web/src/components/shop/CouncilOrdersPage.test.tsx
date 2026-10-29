import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CouncilOrdersPage from "@/app/(protected)/shop/council-orders/page";

const api = vi.hoisted(() => ({
  catalog: vi.fn(), listActivities: vi.fn(), recipientOptions: vi.fn(), orderSummary: vi.fn(), orderQuantities: vi.fn(),
  classPaymentReport: vi.fn(),
  listSupplementOrders: vi.fn(),
  listOrders: vi.fn(), getCloseStatus: vi.fn(), closeCategory: vi.fn(), reopenCategory: vi.fn(), setClassPaid: vi.fn(),
  cancelOrder: vi.fn(), downloadClassReceipt: vi.fn(), downloadClassReceipts: vi.fn(),
}));
const access = vi.hoisted(() => ({ isAdmin: true, permissions: new Set<string>() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, classApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => access }));
vi.mock("sonner", () => ({ toast: notifications }));

const summary = (label = "一年一班") => ({ group_by: "class", total_amount: 300, paid_amount: 0, unpaid_amount: 300,
  rows: [{ key: "class", label, order_count: 1, item_count: 1, total_amount: 300, paid_amount: 0, unpaid_amount: 300 }] });

beforeEach(() => {
  vi.resetAllMocks();
  access.isAdmin = true;
  access.permissions = new Set();
  api.catalog.mockResolvedValue([
    { id: "shirts", name: "衣服", activity_id: "festival", activity_name: "校慶", series: [], products: [{ id: "shirt", name: "紀念衫" }] },
    { id: "bags", name: "袋子", activity_id: "festival", activity_name: "校慶", series: [], products: [] },
    { id: "cards", name: "卡片", activity_id: "winter", activity_name: "冬季活動", series: [], products: [] },
  ]);
  api.listActivities.mockResolvedValue([
    { id: "festival", name: "校慶" },
    { id: "winter", name: "冬季活動" },
  ]);
  api.recipientOptions.mockResolvedValue([]);
  api.orderSummary.mockResolvedValue(summary());
  api.classPaymentReport.mockResolvedValue([]);
  api.listSupplementOrders.mockResolvedValue([]);
  api.orderQuantities.mockResolvedValue([]);
  api.listOrders.mockResolvedValue([]);
  api.getCloseStatus.mockResolvedValue({ statuses: { shirts: { is_closed: false }, bags: { is_closed: false }, cards: { is_closed: false } } });
  api.closeCategory.mockResolvedValue({});
  api.setClassPaid.mockResolvedValue({ updated_orders: 1 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

async function openPage() {
  render(<CouncilOrdersPage />);
  await screen.findByRole("table", { name: "班級訂購與收款彙總" });
  fireEvent.click(screen.getByText(/更多篩選：/));
}

it("only offers school-wide assisted ordering to order managers", async () => {
  access.isAdmin = false;
  access.permissions = new Set(["shop:view_all"]);
  const view = render(<CouncilOrdersPage />);
  await screen.findByText("一年一班");
  expect(screen.queryByText("幫同學代訂")).not.toBeInTheDocument();
  access.permissions = new Set(["shop:manage_orders"]);
  view.rerender(<CouncilOrdersPage />);
  expect(screen.getByText("幫同學代訂")).toBeVisible();
});

describe("全校收款與訂單", () => {
  it("依日期、活動、年級與班級搜尋每日收款明細", async () => {
    const now = new Date();
    api.classPaymentReport.mockResolvedValue([
      {
        class_id: "class-one", class_label: "一年一班", grade: 1, activity_id: "festival",
        activity_label: "校慶", confirmed_at: now.toISOString(), amount: 100, order_count: 2,
      },
      {
        class_id: "class-one", class_label: "一年一班", grade: 1, activity_id: "winter",
        activity_label: "冬季活動", confirmed_at: now.toISOString(), amount: 50, order_count: 1,
      },
      {
        class_id: "class-two", class_label: "二年一班", grade: 2, activity_id: "festival",
        activity_label: "校慶", confirmed_at: now.toISOString(), amount: 300, order_count: 3,
      },
      {
        class_id: "class-old", class_label: "三年一班", grade: 3, activity_id: "festival",
        activity_label: "校慶", confirmed_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        amount: 900, order_count: 4,
      },
    ]);
    await openPage();

    const report = screen.getByRole("region", { name: "每日收款" });
    const statistics = within(report).getByRole("group", { name: "收款統計" });
    expect(within(statistics).getByText("NT$450")).toBeVisible();
    expect(within(statistics).getByText("2 班")).toBeVisible();
    fireEvent.change(within(report).getByRole("combobox", { name: "收款活動" }), {
      target: { value: "festival" },
    });
    fireEvent.change(within(report).getByRole("combobox", { name: "收款年級" }), {
      target: { value: "1" },
    });
    fireEvent.change(within(report).getByRole("searchbox", { name: "搜尋班級" }), {
      target: { value: "一年一班" },
    });

    expect(within(statistics).getByText("NT$100")).toBeVisible();
    expect(within(statistics).getByText("1 班")).toBeVisible();
    const details = within(report).getByRole("table", { name: "收款班級明細" });
    expect(details).toHaveTextContent("校慶");
    expect(within(details).queryByText("冬季活動")).not.toBeInTheDocument();
  });

  it("已確認收款的班級顯示狀態，不再顯示確認按鈕", async () => {
    api.classPaymentReport.mockResolvedValue([{
      class_id: "class", class_label: "一年一班", grade: 1, activity_id: "festival",
      activity_label: "校慶", confirmed_at: new Date().toISOString(), amount: 100, order_count: 1,
    }]);
    await openPage();

    expect(screen.queryByRole("button", { name: "確認一年一班的校慶收款" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("已確認收款")).toBeVisible());
    await waitFor(() => expect(screen.getByRole("button", { name: "確認一年一班的冬季活動收款" })).toBeVisible());
  });

  it("全校唯讀者可查看收款統計但不能確認收款", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    await openPage();

    expect(screen.getByRole("region", { name: "每日收款" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /確認.*收款/ })).not.toBeInTheDocument();
  });

  it("無法取得收款狀態時不提供確認按鈕，並可重試", async () => {
    api.classPaymentReport.mockRejectedValue(new Error("offline"));
    await openPage();

    expect(await screen.findAllByText("收款狀態無法確認")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "確認一年一班的校慶收款" })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "每日收款" })).getByRole("button", { name: "重試" }));
    await waitFor(() => expect(api.classPaymentReport).toHaveBeenCalledTimes(2));
  });

  it("沒有另外建立活動也能在頁面上方全域鎖單商品批次", async () => {
    api.listActivities.mockResolvedValue([]);
    render(<CouncilOrdersPage />);
    const closure = await screen.findByRole("region", { name: "班聯結單與公開入口" });
    expect(closure).toBeVisible();
    expect(closure.closest("details")).toBeNull();
    expect(closure.compareDocumentPosition(screen.getByRole("navigation", { name: "班聯統籌工作" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const lock = within(closure).getByRole("button", { name: "結單並隱藏入口衣服" });
    await waitFor(() => expect(lock).toBeEnabled());
    api.closeCategory.mockImplementationOnce(async () => {
      api.getCloseStatus.mockResolvedValue({ statuses: { shirts: { is_closed: true, is_global: true }, bags: { is_closed: false }, cards: { is_closed: false } } });
      return {};
    });
    fireEvent.click(lock);
    expect(await within(closure).findByRole("status")).toHaveTextContent("商品已從公開目錄隱藏");
    expect(api.closeCategory).toHaveBeenCalledWith("shirts", {});
    expect(api.getCloseStatus).toHaveBeenCalledWith(["shirts", "bags", "cards"]);
    await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2));
    expect(await within(closure).findByRole("button", { name: "重新開放並顯示衣服" })).toBeVisible();
  });

  it("唯讀班聯不顯示全域鎖單", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    render(<CouncilOrdersPage />);
    await screen.findByText("一年一班");
    expect(screen.queryByRole("region", { name: "活動結單與公開入口" })).not.toBeInTheDocument();
  });

  it.each(["shop:manage", "shop:manage_orders"])("具 %s 權限可直接找到全域鎖單", async (permission) => {
    access.isAdmin = false;
    access.permissions = new Set([permission]);
    render(<CouncilOrdersPage />);
    expect(await screen.findByRole("button", { name: "結單並隱藏入口衣服" })).toBeVisible();
  });

  it("downloads the chosen class and activity and shows a retryable receipt error", async () => {
    await openPage();
    const download = await screen.findByRole("button", { name: "下載一年一班的校慶簽收單 PDF" });
    api.downloadClassReceipt.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(download);
    expect(await screen.findByRole("alert")).toHaveTextContent("簽收單下載失敗，請重試。");
    expect(api.downloadClassReceipt).toHaveBeenCalledWith("class", "festival");
    expect(download).toHaveTextContent("重試");
    expect(api.setClassPaid).not.toHaveBeenCalled();
  });

  it("hides class receipts from read-only council users", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    await openPage();
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });
    await waitFor(() => expect(api.getCloseStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /下載.*簽收單/ })).not.toBeInTheDocument();
  });

  it("downloads selected classes or every class for the selected activity without confirming payment", async () => {
    api.orderSummary.mockResolvedValue({
      ...summary(),
      rows: [
        { key: "class-1", label: "一年一班", order_count: 1, item_count: 1, total_amount: 100, paid_amount: 0, unpaid_amount: 100 },
        { key: "class-2", label: "一年二班", order_count: 1, item_count: 1, total_amount: 200, paid_amount: 0, unpaid_amount: 200 },
      ],
    });
    api.downloadClassReceipts.mockResolvedValue(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    await openPage();
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });

    fireEvent.click(await screen.findByRole("checkbox", { name: "選取一年一班收據" }));
    fireEvent.click(screen.getByRole("button", { name: "下載所選 1 班 PDF" }));
    await waitFor(() => expect(api.downloadClassReceipts).toHaveBeenCalledWith("festival", ["class-1"]));

    fireEvent.click(screen.getByRole("button", { name: "下載全部班級 PDF" }));
    await waitFor(() => expect(api.downloadClassReceipts).toHaveBeenCalledWith("festival"));
    expect(api.setClassPaid).not.toHaveBeenCalled();
  });

  const order = {
    id: "old-order", serial_number: "ORD-TEST", user_name: "測試訂購人", class_label: null,
    status: "pending", total_price: 300, is_paid: false, is_class_collected: false,
    created_at: "2026-10-21T00:00:00Z",
  };

  async function openOrders() {
    api.listOrders.mockResolvedValue([order]);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "查找訂單" }));
    await screen.findByText("ORD-TEST");
  }

  it("confirms cancellation with a reason and refreshes the order status", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    expect(api.cancelOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "取消訂單" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("取消原因（選填）"), { target: { value: " 非在校生 " } });
    api.cancelOrder.mockResolvedValue({ ...order, status: "cancelled" });
    api.listOrders.mockResolvedValue([{ ...order, status: "cancelled" }]);
    fireEvent.click(screen.getByRole("button", { name: "確認取消訂單" }));
    await waitFor(() => expect(api.cancelOrder).toHaveBeenCalledWith("old-order", "非在校生"));
    expect(await screen.findByText("訂單 ORD-TEST 已取消。")).toHaveAttribute("role", "status");
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消訂單 ORD-TEST" })).not.toBeInTheDocument());
  });

  it("keeps the reason and allows retry after cancellation fails", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    fireEvent.change(screen.getByLabelText("取消原因（選填）"), { target: { value: "資格不符" } });
    api.cancelOrder.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "確認取消訂單" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("取消失敗，請稍後再試。");
    expect(screen.getByLabelText("取消原因（選填）")).toHaveValue("資格不符");
    expect(screen.getByRole("button", { name: "確認取消訂單" })).toBeEnabled();
  });

  it("prevents another submission while cancellation is pending", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    let finish!: () => void;
    api.cancelOrder.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "確認取消訂單" }));
    expect(screen.getByRole("button", { name: "取消中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled();
    await act(async () => finish());
    expect(api.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it("does not cancel when returning from the confirmation", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });

  it("hides cancellation for a read-only user", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    await openOrders();
    expect(screen.queryByRole("button", { name: "取消訂單 ORD-TEST" })).not.toBeInTheDocument();
  });

  it("explains why a collected order cannot be cancelled", async () => {
    api.listOrders.mockResolvedValue([{ ...order, is_class_collected: true }]);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "查找訂單" }));
    expect(await screen.findByText("已收款，請先撤銷收款再取消")).toBeVisible();
    expect(screen.queryByRole("button", { name: "取消訂單 ORD-TEST" })).not.toBeInTheDocument();
  });

  it("shows class and activity scoped payment actions without selecting an activity", async () => {
    await openPage();
    const festivalPayment = await screen.findByRole("button", { name: "確認一年一班的校慶收款" });
    expect(await screen.findByRole("button", { name: "確認一年一班的冬季活動收款" })).toBeVisible();
    const otherActions = festivalPayment.closest("div")?.parentElement?.querySelector("details");
    expect(otherActions).not.toHaveAttribute("open");
    fireEvent.click(otherActions!.querySelector("summary")!);
    expect(otherActions).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "撤銷一年一班的校慶收款確認" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "停止訂購" })).not.toBeInTheDocument();
    fireEvent.click(festivalPayment);
    await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledWith("class", true, "festival"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("一年一班"));
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });
    await waitFor(() => expect(api.orderSummary).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "shirts" })));
    expect(screen.queryByText("批次管理訂購")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止訂購" })).not.toBeInTheDocument();
  });

  it("活動選單逐一列出主題，切換主題會清除商品並在各分頁用主題篩選", async () => {
    api.catalog.mockResolvedValue([
      ...await api.catalog(),
      { id: "general", name: "一般主題", activity_id: null, series: [], products: [] },
    ]);
    await openPage();
    const select = screen.getByRole("combobox", { name: "活動" });
    expect(select).toHaveTextContent("衣服");
    expect(select).toHaveTextContent("袋子");
    expect(select).toHaveTextContent("一般主題");
    expect(select).not.toHaveTextContent("校慶");
    expect(screen.queryByRole("combobox", { name: "商品主題" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "shirts" } });
    fireEvent.change(screen.getByRole("combobox", { name: "商品" }), { target: { value: "shirt" } });
    fireEvent.change(select, { target: { value: "bags" } });
    await waitFor(() => expect(api.orderSummary).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "bags" })));
    expect(api.orderSummary.mock.lastCall?.[0]).not.toHaveProperty("product_id");
    expect(api.orderSummary.mock.lastCall?.[0]).not.toHaveProperty("activity_id");
    expect(screen.getByRole("combobox", { name: "商品" })).toHaveValue("");
    expect(screen.queryByRole("option", { name: "紀念衫" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "商品總量" }));
    await waitFor(() => expect(api.orderQuantities).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "bags" })));
    fireEvent.click(screen.getByRole("button", { name: "查找訂單" }));
    await waitFor(() => expect(api.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "bags" })));
    fireEvent.change(select, { target: { value: "general" } });
    await waitFor(() => expect(api.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "general" })));
    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    await waitFor(() => expect(api.listOrders.mock.lastCall?.[0]).not.toHaveProperty("category_id"));
  });

  it("ignores an older response after switching activity", async () => {
    await openPage();
    let resolveOld!: (value: ReturnType<typeof summary>) => void;
    api.orderSummary.mockImplementation((params: { category_id?: string }) => params.category_id === "shirts"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(summary("最新班級")));
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "cards" } });
    await screen.findByText("最新班級");
    await act(async () => resolveOld(summary("過期班級")));
    expect(screen.queryByText("過期班級")).not.toBeInTheDocument();
  });

  it("班聯透過確認收款鎖單，沒有手動班級開關", async () => {
    await openPage();
    expect(await screen.findByRole("button", { name: "確認一年一班的校慶收款" })).toBeVisible();
    expect(screen.queryByText("批次管理訂購")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "整批停止訂購" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止訂購" })).not.toBeInTheDocument();
  });

  it("does not present an unavailable closure status as open", async () => {
    api.getCloseStatus.mockRejectedValue(new Error("offline"));
    await openPage();
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });
    await waitFor(() => expect(api.getCloseStatus).toHaveBeenCalled());
    fireEvent.click(screen.getAllByText("其他操作")[0]);
    expect(screen.getAllByText("狀態待確認").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "停止訂購" })).not.toBeInTheDocument();
  });
});
