import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopAdminPage from "@/app/(protected)/shop/admin/page";

const api = vi.hoisted(() => ({
  listCategories: vi.fn(), listProducts: vi.fn(), listActivities: vi.fn(),
  list: vi.fn(), recipientOptions: vi.fn(), orderSummary: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ shopApi: api, classApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const summary = (label: string) => ({ group_by: "class", total_amount: 300, paid_amount: 100, unpaid_amount: 200,
  rows: [{ key: label, label, order_count: 1, item_count: 1, total_amount: 300, paid_amount: 100, unpaid_amount: 200 }] });

beforeEach(() => {
  vi.resetAllMocks();
  api.listCategories.mockResolvedValue([]);
  api.listProducts.mockResolvedValue([]);
  api.list.mockResolvedValue([]);
  api.recipientOptions.mockResolvedValue([]);
  api.listActivities.mockResolvedValue([{ id: "festival", name: "校慶" }, { id: "winter", name: "冬季活動" }]);
  api.orderSummary.mockResolvedValue(summary("初始班級"));
});

async function openStats() {
  render(<ShopAdminPage />);
  fireEvent.click(screen.getByRole("button", { name: "訂購統計" }));
  await screen.findByRole("option", { name: "校慶" });
  await screen.findAllByText("初始班級");
}

describe("商品管理與統計", () => {
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
    api.orderSummary.mockImplementation((params: { activity_id?: string }) => params.activity_id === "festival"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(summary("冬季班級")));
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "festival" } });
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "winter" } });
    await screen.findAllByText("冬季班級");
    await act(async () => resolveOld(summary("過期班級")));
    expect(screen.queryByText("過期班級")).not.toBeInTheDocument();
    expect(screen.getByText(/統計範圍：冬季活動/)).toBeVisible();
  });

  it("retries failed statistics and clears the activity together with other filters", async () => {
    await openStats();
    api.orderSummary.mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "festival" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("統計載入失敗");
    fireEvent.click(screen.getByRole("button", { name: "重新載入統計" }));
    await screen.findAllByText("初始班級");
    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    await waitFor(() => expect(api.orderSummary).toHaveBeenLastCalledWith(expect.objectContaining({ activity_id: "", product_id: "", is_paid: "" })));
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
});
