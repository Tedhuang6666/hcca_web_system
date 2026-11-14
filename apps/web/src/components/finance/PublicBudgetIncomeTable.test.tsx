import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PublicBudgetIncomeTable from "./PublicBudgetIncomeTable";

const item = { id: "income", category: "活動", name: "報名費", income: true, amount: 1000, quantity: null, unit: null, unit_price: null, note: null, is_new: false };
describe("public income status", () => {
  it("shows partial receipts against the current budget", () => {
    render(<PublicBudgetIncomeTable items={[item]} records={[{ category: "活動", name: "報名費", amount: 400 }]} />);
    expect(screen.getByText("部分收款")).toBeVisible();
    expect(screen.getByText("NT$400")).toBeVisible();
  });
  it("keeps receipts visible when a new workbook removes their budget item", () => {
    render(<PublicBudgetIncomeTable items={[]} records={[{ category: "活動", name: "報名費", amount: 400 }, { category: "活動", name: "報名費", amount: 100 }]} />);
    expect(screen.getByText("活動 · 歷史收款")).toBeVisible();
    expect(screen.getByText("NT$500")).toBeVisible();
    expect(screen.getByText("已收款")).toBeVisible();
  });
});
