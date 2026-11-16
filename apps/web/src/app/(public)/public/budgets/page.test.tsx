import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PublicBudgetDetail, PublicBudgetListItem } from "@/lib/types";
import { fetchPublicBudget, fetchPublicBudgets } from "@/lib/publicSeoFetch";
import PublicBudgetsPage from "./page";

vi.mock("@/lib/publicSeoFetch", () => ({
  fetchPublicBudget: vi.fn(),
  fetchPublicBudgets: vi.fn(),
}));
vi.mock("@/lib/seo", () => ({ pageMetadata: vi.fn(() => ({})) }));

const summary: PublicBudgetListItem = {
  id: "budget", name: "學期預算", period_name: "115 學年度上學期", visibility: "approved",
};
const budget: PublicBudgetDetail = {
  ...summary, submissions: [], allocations: [], expenses: [],
  nodes: [{ id: "activity", budget_id: "budget", name: "活動", parent_id: null, sort_order: 0, allocated_amount: 500, used_amount: 300, remaining_amount: 200 }],
  income_items: [{ id: "tickets", category: "活動", name: "票券收入", income: true, amount: 400, quantity: null, unit: null, unit_price: null, note: null, is_new: false }],
  income_records: [{ id: "receipt", income_item_id: "tickets", category: "活動", name: "票券收入", amount: 200, entry_date: "2026-11-01" }],
};

describe("public finance overview", () => {
  it("separates budgets from registered receipts and uses the same data for activity totals", async () => {
    vi.mocked(fetchPublicBudgets).mockResolvedValue({ data: [summary], status: 200 });
    vi.mocked(fetchPublicBudget).mockResolvedValue(budget);
    render(await PublicBudgetsPage());

    const planned = screen.getByRole("region", { name: "核准預算" });
    expect(within(planned).getByText("NT$400")).toBeVisible();
    expect(within(planned).getByText("NT$500")).toBeVisible();
    expect(within(planned).getByText("60.0%")).toBeVisible();
    const registered = screen.getByRole("region", { name: "已登錄收支" });
    expect(within(registered).getByText("NT$200")).toBeVisible();
    expect(within(registered).getByText("NT$300")).toBeVisible();
    expect(within(registered).getByText("-NT$100")).toBeVisible();
    expect(within(registered).getByText("預算收支差額（非帳戶餘額）")).toBeVisible();
    expect(screen.getAllByText("-NT$100")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "查看「票券收入」的收入紀錄" })).toBeVisible();
  });

  it("withholds all totals when a current budget fails to load", async () => {
    vi.mocked(fetchPublicBudgets).mockResolvedValue({ data: [summary, { ...summary, id: "second" }], status: 200 });
    vi.mocked(fetchPublicBudget).mockImplementation(async (id) => id === "budget" ? budget : null);
    render(await PublicBudgetsPage());
    expect(screen.getByRole("alert")).toHaveTextContent("目前無法讀取收支明細");
    expect(screen.queryByRole("region", { name: "已登錄收支" })).not.toBeInTheDocument();
  });

  it("shows the empty state when only drafts are public", async () => {
    vi.mocked(fetchPublicBudgets).mockResolvedValue({ data: [{ ...summary, visibility: "council_review" }], status: 200 });
    render(await PublicBudgetsPage());
    expect(screen.getByRole("heading", { name: "目前沒有公開中的核准預算" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "核准預算" })).not.toBeInTheDocument();
  });

  it("does not show zero totals when the budget list is unavailable", async () => {
    vi.mocked(fetchPublicBudgets).mockResolvedValue({ data: null, status: null });
    render(await PublicBudgetsPage());
    expect(screen.getByRole("status")).toHaveTextContent("目前無法讀取公開預算資料");
    expect(screen.queryByRole("region", { name: "已登錄收支" })).not.toBeInTheDocument();
  });
});
