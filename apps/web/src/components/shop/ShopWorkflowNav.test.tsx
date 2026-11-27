import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ShopWorkflowNav, { shopWorkflowSteps } from "./ShopWorkflowNav";

describe("ShopWorkflowNav", () => {
  it("只列出權限允許的步驟", () => {
    const viewer = { manage: false, confirm: false, report: false };
    expect(shopWorkflowSteps("council", viewer).map((step) => step.key))
      .toEqual(["orders", "summary", "quantities", "distribution", "analytics"]);
    expect(shopWorkflowSteps("admin", viewer)).toEqual([]);
    expect(shopWorkflowSteps("council", { ...viewer, report: true }).map((step) => step.key)).toContain("daily");
  });

  it("同頁步驟用按鈕切換，跨頁步驟用連結並標示目前階段", () => {
    const onSelect = vi.fn();
    render(<ShopWorkflowNav page="council" current="receipts" onSelect={onSelect}
      access={{ manage: true, confirm: true, report: true }} />);
    const nav = screen.getByRole("navigation", { name: "商品作業流程" });
    expect(within(nav).getByRole("button", { name: "收款單據" })).toHaveAttribute("aria-pressed", "true");
    expect(within(nav).getByRole("link", { name: "商品設定" })).toHaveAttribute("href", "/shop/admin");
    within(nav).getByRole("button", { name: "結單設定" }).click();
    expect(onSelect).toHaveBeenCalledWith("closure");
    expect(within(nav).getByText("收款與收據").closest("li")).toHaveAttribute("data-active", "true");
  });
});
