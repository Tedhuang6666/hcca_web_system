import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CouncilOrdersPage from "@/app/(protected)/shop/council-orders/page";

const api = vi.hoisted(() => ({
  catalog: vi.fn(), recipientOptions: vi.fn(), orderSummary: vi.fn(), orderQuantities: vi.fn(),
  listOrders: vi.fn(), getCloseStatus: vi.fn(), closeCategory: vi.fn(), reopenCategory: vi.fn(), setClassPaid: vi.fn(),
}));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, classApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set<string>() }) }));
vi.mock("sonner", () => ({ toast: notifications }));

const summary = (label = "一年一班") => ({ group_by: "class", total_amount: 300, paid_amount: 0, unpaid_amount: 300,
  rows: [{ key: "class", label, order_count: 1, item_count: 1, total_amount: 300, paid_amount: 0, unpaid_amount: 300 }] });

beforeEach(() => {
  vi.resetAllMocks();
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
