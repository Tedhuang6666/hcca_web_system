import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ShopNoteGroupsPanel from "./ShopNoteGroupsPanel";

const api = vi.hoisted(() => ({ listCategories: vi.fn(), listSeries: vi.fn(), listProducts: vi.fn(),
  getProductPurchaseRules: vi.fn(), lookupTargets: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

const regular = { id: "regular", name: "一般票", category_id: "concert", series_id: null };
const bundle = { id: "bundle", name: "套票", category_id: null, series_id: "tickets" };
const allowed = ["310001", "310002", "310003", "310004", "310005"];
beforeEach(() => {
  vi.resetAllMocks();
  api.listCategories.mockResolvedValue([{ id: "concert", name: "校園演唱會", activity_id: "activity" },
    { id: "other", name: "其他主題", activity_id: null }]);
  api.listSeries.mockResolvedValue([{ id: "tickets", category_id: "concert" }]);
  api.listProducts.mockResolvedValue([regular, bundle, { id: "other-product", category_id: "other" }]);
  api.getProductPurchaseRules.mockResolvedValue({ allowed_identifiers: allowed,
    blocked_identifiers: [], identifier_notes: Object.fromEntries(allowed.map((identifier) => [identifier, "熱音"])) });
  api.lookupTargets.mockImplementation(async ({ identifiers }: { identifiers: string[] }) => identifiers.map((identifier, index) => ({
    identifier, display_name: `合成人員 ${index + 1}`, class_label: "三年一班", seat_number: index + 1,
    matched: true, has_ordered: index === 0,
  })));
});

async function selectCategory() {
  await screen.findByRole("option", { name: "校園演唱會" });
  fireEvent.change(screen.getByRole("combobox", { name: "商品主題" }), { target: { value: "concert" } });
}

it("同主題跨系列依備註彙總各票種五人，展開才核對名單與訂購狀態", async () => {
  render(<ShopNoteGroupsPanel />);
  await selectCategory();
  const group = await screen.findByRole("region", { name: "備註：熱音" });
  expect(within(group).getByRole("button", { name: "一般票 5 人 · 查看名單" })).toBeVisible();
  expect(within(group).getByRole("button", { name: "套票 5 人 · 查看名單" })).toBeVisible();
  expect(api.getProductPurchaseRules).toHaveBeenCalledTimes(2);
  expect(api.getProductPurchaseRules).not.toHaveBeenCalledWith("other-product");
  expect(api.lookupTargets).not.toHaveBeenCalled();
  fireEvent.click(within(group).getByRole("button", { name: /一般票/ }));
  expect(await screen.findByText("合成人員 1")).toBeVisible();
  expect(screen.getByText("已訂購")).toBeVisible();
  expect(screen.getAllByText("未訂購")).toHaveLength(4);
  expect(api.lookupTargets).toHaveBeenCalledWith({ activity_id: "activity", product_id: "regular", keyword: "", identifiers: allowed });
  fireEvent.click(within(group).getByRole("button", { name: /套票/ }));
  await screen.findByRole("list", { name: "套票人員名單" });
  await waitFor(() => expect(api.lookupTargets).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByRole("searchbox", { name: "搜尋備註" }), { target: { value: "熱音" } });
  expect(api.lookupTargets).toHaveBeenCalledTimes(2);
});

it("忽略備註前後空白，空白另列一組，排除禁止名單、重複及過期備註", async () => {
  api.getProductPurchaseRules.mockResolvedValue({ allowed_identifiers: ["1", "1", "2", "3", "4", "5"],
    blocked_identifiers: ["5"], identifier_notes: { "1": " 熱音 ", "2": "熱音", "3": "", "4": "  ", "5": "禁止", "old": "過期" } });
  render(<ShopNoteGroupsPanel />);
  await selectCategory();
  const group = await screen.findByRole("region", { name: "備註：熱音" });
  expect(within(group).getByRole("button", { name: /一般票 2 人/ })).toBeVisible();
  expect(within(screen.getByRole("region", { name: "備註：未填備註" })).getByRole("button", { name: /套票 2 人/ })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "過期" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "禁止" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在" } });
  expect(screen.getByText(/沒有符合的備註分組/)).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "未填備註" } });
  expect(screen.queryByRole("region", { name: "備註：熱音" })).not.toBeInTheDocument();
});

it("讀取完整商品分頁，任一購買名單失敗時隱藏不完整合計，重試後恢復", async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({ ...regular, id: `regular-${index}` }));
  api.listProducts.mockImplementation(async ({ offset }: { offset: string }) => offset === "0" ? page : [bundle]);
  api.getProductPurchaseRules.mockRejectedValueOnce(new Error("offline"));
  render(<ShopNoteGroupsPanel />);
  await selectCategory();
  expect(await screen.findByRole("alert")).toHaveTextContent("購買名單讀取失敗");
  expect(screen.queryByRole("region", { name: "備註：熱音" })).not.toBeInTheDocument();
  expect(api.listProducts).toHaveBeenCalledWith({ limit: "100", offset: "100" });
  fireEvent.click(screen.getByRole("button", { name: "重新讀取購買名單" }));
  expect(await screen.findByRole("button", { name: "套票 5 人 · 查看名單" })).toBeVisible();
});

it("切換主題後忽略舊回應；空名單與名單核對失敗皆有回饋及重試", async () => {
  let resolve!: (rules: object) => void;
  api.getProductPurchaseRules.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  render(<ShopNoteGroupsPanel />);
  await selectCategory();
  await waitFor(() => expect(api.getProductPurchaseRules).toHaveBeenCalledWith("regular"));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });
  expect(await screen.findByRole("region", { name: "備註：熱音" })).toBeVisible();
  await act(async () => resolve({ allowed_identifiers: ["old"], identifier_notes: { old: "舊組" } }));
  expect(screen.queryByRole("heading", { name: "舊組" })).not.toBeInTheDocument();
  api.getProductPurchaseRules.mockResolvedValue({ allowed_identifiers: [] });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "concert" } });
  expect(await screen.findByText(/此主題尚無允許購買名單/)).toBeVisible();
});

it("核對失敗保留識別碼且不誤標未訂購，重試並逐批查看超過五十人", async () => {
  const identifiers = Array.from({ length: 51 }, (_, index) => String(310001 + index));
  api.getProductPurchaseRules.mockResolvedValue({ allowed_identifiers: identifiers });
  api.lookupTargets.mockRejectedValueOnce(new Error("offline"));
  render(<ShopNoteGroupsPanel />);
  await selectCategory();
  fireEvent.click(await screen.findByRole("button", { name: /一般票 51 人/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("名單核對失敗");
  expect(screen.queryByText("未訂購")).not.toBeInTheDocument();
  expect(screen.getAllByText("狀態待核對")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button", { name: "重新核對" }));
  expect(await screen.findByText("合成人員 1")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "再顯示 50 人（剩餘 1 人）" }));
  expect(screen.getByText("合成人員 51")).toBeVisible();
});

it("商品目錄載入失敗可重試，無主題時說明下一步", async () => {
  api.listCategories.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
  render(<ShopNoteGroupsPanel />);
  expect(await screen.findByRole("alert")).toHaveTextContent("商品目錄讀取失敗");
  fireEvent.click(screen.getByRole("button", { name: "重新載入商品目錄" }));
  expect(await screen.findByText(/尚未建立商品主題/)).toBeVisible();
});
