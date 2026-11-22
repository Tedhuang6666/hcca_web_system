import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ShopSheetImportPanel from "./ShopSheetImportPanel";
import type { ProductCategoryOut } from "@/lib/types";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), configure: vi.fn(), enable: vi.fn(), sync: vi.fn(), rows: vi.fn(), listProducts: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopSheetApi: api, shopApi: { listProducts: api.listProducts }, apiErrorMessage: (_cause: unknown, fallback: string) => fallback }));
const categories: ProductCategoryOut[] = [{ id: "category", name: "校慶商品", sort_order: 0, is_active: true,
  created_at: "2026-11-09T00:00:00Z", updated_at: "2026-11-09T00:00:00Z", created_by: "manager",
  description: null, image_url: null, activity_id: null }];
const source = { id: "source", name: "教師預購", spreadsheet_id: "1otp3Zr-1iRPE2TRzr0Iu5NQmf3XgrkYE_JUT0LQ8f18", sheet_name: "表單回覆 1", category_id: "category", enabled: false, config: {}, last_synced_at: null, last_error: null };

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.resetAllMocks(); api.list.mockResolvedValue([source]); api.rows.mockResolvedValue([]);
  api.listProducts.mockResolvedValue([{ id: "product", name: "風衣外套" }]);
});

it("creates a disabled source and keeps the form after a failed save", async () => {
  api.list.mockResolvedValue([]); api.create.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(source);
  render(<ShopSheetImportPanel categories={categories} />);
  await screen.findByText(/尚未設定來源/);
  fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "category" } });
  fireEvent.click(screen.getByRole("button", { name: "新增同步來源" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("設定未儲存");
  expect(screen.getByRole("textbox", { name: "來源名稱" })).toHaveValue("教師與組織預購");
  fireEvent.click(screen.getByRole("button", { name: "新增同步來源" }));
  await waitFor(() => expect(api.create).toHaveBeenLastCalledWith(expect.objectContaining({
    category_id: "category", enabled: false, spreadsheet_id: source.spreadsheet_id,
    config: expect.objectContaining({ email_column: "電子郵件地址" }),
  })));
  expect(await screen.findByRole("button", { name: "儲存同步設定" })).toBeEnabled();
});

it("syncs once, shows review reasons and enables polling separately", async () => {
  api.sync.mockResolvedValue({ imported: 1, updated: 3, skipped: 2, review: 1 });
  api.rows.mockResolvedValue([{ id: "row", row_number: 3, status: "review", error: "尺寸缺漏", order_ids: [] }]);
  api.enable.mockResolvedValue({ ...source, enabled: true });
  render(<ShopSheetImportPanel categories={categories} />);
  fireEvent.click(await screen.findByRole("button", { name: "同步一次：教師預購" }));
  expect(await screen.findByText(/本次同步：新增 1 筆、更新 3 筆、略過 2 筆、待確認 1 筆/)).toBeInTheDocument();
  expect(await screen.findByText("尺寸缺漏")).toBeInTheDocument();
  expect(api.enable).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "啟用自動同步：教師預購" }));
  await waitFor(() => expect(api.enable).toHaveBeenCalledWith("source", true));
});

it("retries loading and preserves explicit column mapping when editing", async () => {
  api.list.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([source]);
  api.configure.mockResolvedValue(source);
  render(<ShopSheetImportPanel categories={categories} />);
  fireEvent.click(await screen.findByRole("button", { name: "重新載入來源" }));
  fireEvent.click(await screen.findByRole("button", { name: "編輯設定：教師預購" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "來源名稱" })).toHaveFocus());
  fireEvent.click(screen.getByText("欄位名稱與商品對應"));
  fireEvent.change(screen.getByRole("textbox", { name: "試算表商品欄名" }), { target: { value: "衣服" } });
  await screen.findByRole("option", { name: "風衣外套" });
  fireEvent.change(screen.getByRole("combobox", { name: "對應商品" }), { target: { value: "product" } });
  fireEvent.click(screen.getByRole("button", { name: "加入欄位對應" }));
  fireEvent.click(screen.getByRole("button", { name: "儲存同步設定" }));
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith("source", expect.objectContaining({
    config: expect.objectContaining({ product_columns: { "衣服": "product" } }),
  })));
  expect(screen.getByRole("textbox", { name: "Google 試算表網址" })).toHaveAttribute("readonly");
});
