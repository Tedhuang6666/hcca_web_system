import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import ProductPurchaseRulesEditor, { emptyPurchaseRules, type PurchaseRulesDraft } from "./ProductPurchaseRulesEditor";

const api = vi.hoisted(() => ({ purchasePermissions: vi.fn(), purchaseGroupOptions: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api }));
beforeEach(() => { vi.resetAllMocks(); api.purchaseGroupOptions.mockResolvedValue([{ id: "work", name: "工作票" }, { id: "show", name: "表演票" }, { id: "general", name: "一般預售票" }]); api.purchasePermissions.mockResolvedValue([{ code: "shop:manage", label: "管理商品", group: "商品" }]); });
function Editor({ initial = emptyPurchaseRules }: { initial?: PurchaseRulesDraft }) {
  const [value, setValue] = useState(initial);
  return <><ProductPurchaseRulesEditor value={value} onChange={setValue} disabled={false} activityId="event" categoryId="category" productId="work" />
    <output data-testid="rules">{JSON.stringify(value)}</output></>;
}
it("設定年級、權限、名單、限購群組與指定票種模式", async () => {
  render(<Editor />);
  fireEvent.click(screen.getByLabelText("高三"));
  await waitFor(() => expect(screen.getByLabelText("必要權限")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("必要權限"), { target: { value: "shop:manage" } });
  fireEvent.change(screen.getByLabelText("允許購買名單"), { target: { value: "310001，310001\nSTUDENT@EXAMPLE.TEST" } });
  fireEvent.change(screen.getByLabelText("禁止購買名單"), { target: { value: "310002 310003" } });
  fireEvent.click(await screen.findByLabelText("表演票"));
  fireEvent.click(screen.getByLabelText("一般預售票"));
  fireEvent.click(screen.getByLabelText("指定票種（僅名單可買，並鎖定同組其他商品）"));
  expect(JSON.parse(screen.getByTestId("rules").textContent!)).toEqual({
    allowed_grades: [3], required_permissions: ["shop:manage"], allowed_identifiers: ["310001", "student@example.test"],
    blocked_identifiers: ["310002", "310003"], exclusive_group: null, exclusive_product_ids: ["show", "work", "general"], designated_only: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "移除權限 shop:manage" }));
  expect(JSON.parse(screen.getByTestId("rules").textContent!).required_permissions).toEqual([]);
});
it("權限載入失敗時保留原條件，支援重新讀取", async () => {
  api.purchasePermissions.mockRejectedValueOnce(new Error("offline"));
  render(<Editor initial={{ ...emptyPurchaseRules, required_permissions: ["shop:manage"], blocked_identifiers: ["310001"] }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("原有條件已保留");
  expect(screen.getByLabelText("禁止購買名單")).toHaveValue("310001");
  fireEvent.click(screen.getByRole("button", { name: "重新讀取" }));
  expect(await screen.findByText("管理商品")).toBeVisible();
  expect(JSON.parse(screen.getByTestId("rules").textContent!).required_permissions).toEqual(["shop:manage"]);
});
