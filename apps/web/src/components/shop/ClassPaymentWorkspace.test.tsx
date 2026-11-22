import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ClassPaymentWorkspace from "./ClassPaymentWorkspace";
import type { CatalogCategoryOut } from "@/lib/types";

const api = vi.hoisted(() => ({ orderSummary: vi.fn(), setClassPaid: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

const catalog: CatalogCategoryOut[] = [
  { id: "love", name: "傳情", activity_id: null, sort_order: 0, series: [], products: [] },
  { id: "dance", name: "舞會", activity_id: null, sort_order: 0, series: [], products: [] },
  { id: "old", name: "去年園遊會", activity_id: null, sort_order: 0, order_closed_at: "2025-01-01T00:00:00Z", series: [], products: [] },
];
const props = { catalog, activities: [], optionsLoading: false, optionsError: false,
  refreshKey: 0, disabled: false, onChanged: vi.fn(), onBusyChange: vi.fn() };
const summary = (amount: number) => ({ rows: [{ key: "class", label: "一年一班", unpaid_amount: amount, paid_amount: 0 }] });

beforeEach(() => {
  vi.resetAllMocks();
  api.orderSummary.mockImplementation(async ({ category_id }: { category_id?: string }) => summary(category_id === "love" ? 100 : 300));
  api.setClassPaid.mockResolvedValue({});
});

it("切換活動時只顯示及送出目前活動金額，明細入口保留活動範圍", async () => {
  const onViewClass = vi.fn();
  render(<ClassPaymentWorkspace {...props} onViewClass={onViewClass} />);
  expect(api.orderSummary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: "傳情" }));
  await screen.findByRole("button", { name: "核對一年一班收款" });
  expect(screen.getByText("核對傳情收款 NT$100")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "舞會" }));
  expect(screen.queryByText("核對傳情收款 NT$100")).not.toBeInTheDocument();
  await screen.findByText("核對舞會收款 NT$300");
  fireEvent.click(screen.getByRole("button", { name: "查看一年一班訂購明細" }));
  expect(onViewClass).toHaveBeenCalledWith("class", "一年一班", expect.objectContaining({ key: "category:dance" }));
  fireEvent.click(screen.getByRole("button", { name: "核對一年一班收款" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).not.toHaveTextContent("傳情");
  expect(dialog).not.toHaveTextContent("NT$400");
  fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
  await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledExactlyOnceWith("class", true, null, "dance"));
});

it("已結單與截止活動預設隱藏，需明確展開及選取才能查詢", async () => {
  render(<ClassPaymentWorkspace {...props} catalog={[
    catalog[2], { ...catalog[0], order_closes_at: "2025-01-01T00:00:00Z" },
  ]} />);
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(api.orderSummary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /查看已結單活動/ }));
  expect(api.orderSummary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: /去年園遊會/ }));
  await screen.findByRole("button", { name: "核對一年一班收款" });
  expect(api.orderSummary).toHaveBeenCalledExactlyOnceWith({ group_by: "class", category_id: "old" });
});

it("較晚回傳的舊活動金額不會覆蓋新活動", async () => {
  let resolveOld!: (value: ReturnType<typeof summary>) => void;
  api.orderSummary.mockImplementation(({ category_id }: { category_id: string }) => category_id === "love"
    ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(summary(300)));
  render(<ClassPaymentWorkspace {...props} />);
  fireEvent.click(screen.getByRole("radio", { name: "傳情" }));
  fireEvent.click(screen.getByRole("radio", { name: "舞會" }));
  await screen.findByText("核對舞會收款 NT$300");
  await act(async () => resolveOld(summary(100)));
  expect(screen.queryByText(/NT\$100/)).not.toBeInTheDocument();
});
