import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CouncilOrdersPage from "@/app/(protected)/shop/council-orders/page";

const api = vi.hoisted(() => ({
  catalog: vi.fn(), recipientOptions: vi.fn(), orderSummary: vi.fn(), orderQuantities: vi.fn(),
  listOrders: vi.fn(), getCloseStatus: vi.fn(), closeCategory: vi.fn(), reopenCategory: vi.fn(), setClassPaid: vi.fn(),
  cancelOrder: vi.fn(),
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
  api.recipientOptions.mockResolvedValue([]);
  api.orderSummary.mockResolvedValue(summary());
  api.orderQuantities.mockResolvedValue([]);
  api.listOrders.mockResolvedValue([]);
  api.getCloseStatus.mockResolvedValue({ statuses: { shirts: { is_closed: false }, bags: { is_closed: false }, cards: { is_closed: false } } });
  api.closeCategory.mockResolvedValue({});
  api.setClassPaid.mockResolvedValue({ updated_orders: 1 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

async function openPage() {
  render(<CouncilOrdersPage />);
  await screen.findByText("一年一班");
  fireEvent.click(screen.getByText(/更多篩選：/));
}

describe("全校收款與訂單", () => {
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

  it("shows totals first, then scoped payment actions after selecting an activity", async () => {
    await openPage();
    expect(screen.getByText(/選擇一個活動後，可確認班級收款/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "確認收款" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "festival" } });
    await screen.findByText("批次管理訂購");
    expect(screen.getAllByRole("button", { name: "確認收款" }).length).toBeGreaterThan(0);
    const otherActions = screen.getAllByText("其他操作")[0].closest("details");
    expect(otherActions).not.toHaveAttribute("open");
    fireEvent.click(screen.getAllByText("其他操作")[0]);
    expect(otherActions).toHaveAttribute("open");
    expect(screen.getAllByRole("button", { name: "撤銷收款確認" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "停止訂購" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "確認收款" })[0]);
    await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledWith("class", true, "festival"));
  });

  it("clears dependent product and category filters when changing activity", async () => {
    await openPage();
    fireEvent.change(screen.getByRole("combobox", { name: "商品主題" }), { target: { value: "shirts" } });
    fireEvent.change(screen.getByRole("combobox", { name: "商品" }), { target: { value: "shirt" } });
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "winter" } });
    await waitFor(() => expect(api.orderSummary).toHaveBeenLastCalledWith(expect.objectContaining({ activity_id: "winter" })));
    expect(api.orderSummary.mock.lastCall?.[0]).not.toHaveProperty("product_id");
    expect(api.orderSummary.mock.lastCall?.[0]).not.toHaveProperty("category_id");
    expect(screen.getByRole("combobox", { name: "商品主題" })).toHaveValue("");
    expect(screen.queryByRole("option", { name: "衣服" })).not.toBeInTheDocument();
  });

  it("ignores an older response after switching activity", async () => {
    await openPage();
    let resolveOld!: (value: ReturnType<typeof summary>) => void;
    api.orderSummary.mockImplementation((params: { activity_id?: string }) => params.activity_id === "festival"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(summary("最新班級")));
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "festival" } });
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "winter" } });
    await screen.findByText("最新班級");
    await act(async () => resolveOld(summary("過期班級")));
    expect(screen.queryByText("過期班級")).not.toBeInTheDocument();
  });

  it("requires batch confirmation and reports a partial failure", async () => {
    await openPage();
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "festival" } });
    fireEvent.click(await screen.findByText("批次管理訂購"));
    const stop = await screen.findByRole("button", { name: "整批停止訂購" });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(stop);
    expect(api.closeCategory).not.toHaveBeenCalled();
    api.closeCategory.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(stop);
    expect(await screen.findByText(/1 項未完成/)).toHaveAttribute("role", "status");
    expect(notifications.success).not.toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledWith(expect.stringContaining("1 項未完成"));
    expect(api.closeCategory).toHaveBeenCalledTimes(2);
  });

  it("does not present an unavailable closure status as open", async () => {
    api.getCloseStatus.mockRejectedValue(new Error("offline"));
    await openPage();
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "festival" } });
    await screen.findByText("批次管理訂購");
    fireEvent.click(screen.getAllByText("其他操作")[0]);
    expect(screen.getAllByText("狀態待確認").length).toBeGreaterThan(0);
    for (const button of screen.getAllByRole("button", { name: "停止訂購" })) expect(button).toBeDisabled();
  });
});
