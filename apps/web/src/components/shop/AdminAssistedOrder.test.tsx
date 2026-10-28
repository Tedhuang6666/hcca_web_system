import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AdminAssistedOrder from "./AdminAssistedOrder";
import type { CatalogCategoryOut, SchoolClassListItem } from "@/lib/types";

const api = vi.hoisted(() => ({ listOrderRecipients: vi.fn(), getProduct: vi.fn(), createAdminAssistedOrder: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
const catalog: CatalogCategoryOut[] = [{ id: "cat", name: "紀念品", activity_name: "校慶", sort_order: 0, series: [], products: [
  { id: "shirt", name: "紀念衫", price: 100, status: "active", stock_quantity: 10, is_unlimited: false, has_variants: true, requires_seating: false },
] }];
const classes: SchoolClassListItem[] = [
  { id: "one", label: "一年一班", academic_year: 115, class_code: "101", grade: 1, is_active: true },
  { id: "two", label: "二年二班", academic_year: 115, class_code: "202", grade: 2, is_active: true },
];
const onCreated = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  api.listOrderRecipients.mockResolvedValue([{ id: "seat", user_id: null, roster_entry_id: "roster", display_name: "名冊同學", student_id: "11520", seat_number: 20 }]);
  api.getProduct.mockResolvedValue({ id: "shirt", name: "紀念衫", price: 100, status: "active", variant_groups: [
    { id: "size", name: "尺寸", options: [{ id: "large", value: "L", price_delta: 20, is_active: true }] },
  ] });
  api.createAdminAssistedOrder.mockResolvedValue([{ total_price: 240 }]);
});

function open() {
  render(<AdminAssistedOrder catalog={catalog} classes={classes} optionsError={false} onRetry={vi.fn()} onCreated={onCreated} />);
  fireEvent.click(screen.getByText("幫同學代訂"));
}

async function draft() {
  fireEvent.change(screen.getByRole("combobox", { name: "代訂班級" }), { target: { value: "two" } });
  await screen.findByRole("option", { name: /名冊同學/ });
  fireEvent.change(screen.getByRole("combobox", { name: "代訂同學" }), { target: { value: "seat" } });
  fireEvent.change(screen.getByRole("combobox", { name: "代訂商品" }), { target: { value: "shirt" } });
  await screen.findByRole("combobox", { name: "尺寸（必選）" });
  expect(screen.getByRole("button", { name: "加入代訂清單" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "尺寸（必選）" }), { target: { value: "large" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "數量" }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "加入代訂清單" }));
}

it("selects another class and an unregistered student, locks the recipient and submits variants", async () => {
  open();
  await draft();
  expect(api.listOrderRecipients).toHaveBeenCalledWith("two");
  expect(screen.getByRole("combobox", { name: "代訂班級" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "代訂同學" })).toBeDisabled();
  expect(screen.getByText(/紀念衫（L） × 2/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "送出代訂" }));
  await waitFor(() => expect(api.createAdminAssistedOrder).toHaveBeenCalledWith({
    roster_entry_id: "roster", items: [{ product_id: "shirt", quantity: 2, option_ids: ["large"] }], notes: null,
  }));
  expect(await screen.findByText(/已為 二年二班 名冊同學 完成代訂，合計 NT\$240/)).toBeVisible();
  expect(onCreated).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "送出代訂" })).toBeDisabled();
});

it("keeps the draft on failure and prevents duplicate submissions", async () => {
  let reject: (error: Error) => void = () => {};
  api.createAdminAssistedOrder.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  open();
  await draft();
  fireEvent.click(screen.getByRole("button", { name: "送出代訂" }));
  expect(screen.getByRole("button", { name: "代訂送出中…" })).toBeDisabled();
  expect(api.createAdminAssistedOrder).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("offline")));
  expect(await screen.findByRole("alert")).toHaveTextContent("代訂失敗，清單已保留，請重試。");
  expect(screen.getByText(/紀念衫（L） × 2/)).toBeVisible();
  api.createAdminAssistedOrder.mockResolvedValue([{ total_price: 240 }]);
  fireEvent.click(screen.getByRole("button", { name: "送出代訂" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
});

it("discards stale class responses and retries a failed roster", async () => {
  let resolve: (data: unknown[]) => void = () => {};
  api.listOrderRecipients.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  api.listOrderRecipients.mockRejectedValueOnce(new Error("offline"));
  open();
  fireEvent.change(screen.getByRole("combobox", { name: "代訂班級" }), { target: { value: "one" } });
  expect(screen.getByText("載入學生名冊中…")).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "代訂班級" }), { target: { value: "two" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("名冊載入失敗");
  await act(async () => resolve([{ id: "stale", display_name: "舊班同學", user_id: "old" }]));
  expect(screen.queryByRole("option", { name: /舊班同學/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重試名冊" }));
  expect(await screen.findByRole("option", { name: /名冊同學/ })).toBeInTheDocument();
});

it("shows empty rosters and uses user_id for students who already have accounts", async () => {
  api.listOrderRecipients.mockResolvedValueOnce([]);
  api.listOrderRecipients.mockResolvedValueOnce([{ id: "student", user_id: "account", display_name: "已登入同學" }]);
  open();
  fireEvent.change(screen.getByRole("combobox", { name: "代訂班級" }), { target: { value: "one" } });
  expect(await screen.findByText("沒有符合的同學，請調整搜尋或確認班級名冊。")).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "代訂班級" }), { target: { value: "two" } });
  await screen.findByRole("option", { name: "已登入同學" });
  fireEvent.change(screen.getByRole("combobox", { name: "代訂同學" }), { target: { value: "student" } });
  fireEvent.change(screen.getByRole("combobox", { name: "代訂商品" }), { target: { value: "shirt" } });
  fireEvent.change(await screen.findByRole("combobox", { name: "尺寸（必選）" }), { target: { value: "large" } });
  fireEvent.click(screen.getByRole("button", { name: "加入代訂清單" }));
  fireEvent.click(screen.getByRole("button", { name: "送出代訂" }));
  await waitFor(() => expect(api.createAdminAssistedOrder).toHaveBeenCalledWith(expect.objectContaining({ user_id: "account" })));
});
