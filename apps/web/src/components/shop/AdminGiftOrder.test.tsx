import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AdminAssistedOrder from "./AdminAssistedOrder";
import type { CatalogCategoryOut, SchoolClassListItem } from "@/lib/types";

const api = vi.hoisted(() => ({ listOrderRecipients: vi.fn(), getProduct: vi.fn(), createAdminAssistedOrder: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

const product = { id: "shirt", name: "紀念衫", price: 100, status: "active" as const,
  stock_quantity: 10, purchase_allowed: true, is_unlimited: false, has_variants: true,
  has_option_surcharge: true, requires_seating: false };
const catalog: CatalogCategoryOut[] = [{ id: "cat", name: "紀念品", sort_order: 0, series: [], products: [product] }];
const classes: SchoolClassListItem[] = [
  { id: "class", label: "一年一班", academic_year: 115, class_code: "101", grade: 1, is_active: true },
];

beforeEach(() => {
  vi.resetAllMocks();
  api.listOrderRecipients.mockResolvedValue([{ id: "seat", roster_entry_id: "roster", display_name: "名冊同學" }]);
  api.getProduct.mockResolvedValue({ id: "shirt", name: "紀念衫", price: 100, status: "active", variant_groups: [
    { id: "size", name: "尺寸", options: [{ id: "large", value: "L", price_delta: 20, is_active: true }] },
  ] });
  api.createAdminAssistedOrder.mockResolvedValue([{ total_price: 0 }]);
});

it("贈品導向優惠設定，代訂保留規格加價並在失敗後保留清單", async () => {
  const created = vi.fn();
  render(<AdminAssistedOrder catalog={catalog} classes={classes} optionsError={false} onRetry={vi.fn()} onCreated={created} defaultOpen />);
  expect(screen.queryByRole("option", { name: "贈送（免付款）" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "設定贈品優惠" }))
    .toHaveAttribute("href", "/shop/admin?view=promotions");
  fireEvent.change(screen.getByRole("combobox", { name: "代訂班級" }), { target: { value: "class" } });
  await screen.findByRole("option", { name: "名冊同學" });
  fireEvent.change(screen.getByRole("combobox", { name: "代訂同學" }), { target: { value: "seat" } });
  fireEvent.change(screen.getByRole("combobox", { name: "代訂商品" }), { target: { value: "shirt" } });
  fireEvent.change(await screen.findByRole("combobox", { name: "尺寸（必選）" }), { target: { value: "large" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "數量" }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "加入代訂清單" }));
  expect(screen.getByText(/紀念衫（L） × 2/)).toHaveTextContent("NT$240");
  api.createAdminAssistedOrder.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "送出代訂" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("代訂失敗，清單已保留，請重試。");
  expect(screen.getByText(/紀念衫（L） × 2/)).toBeVisible();
  api.createAdminAssistedOrder.mockResolvedValue([{ total_price: 240 }]);
  fireEvent.click(screen.getByRole("button", { name: "送出代訂" }));
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  expect(api.createAdminAssistedOrder).toHaveBeenLastCalledWith({ roster_entry_id: "roster",
    items: [{ product_id: "shirt", quantity: 2, option_ids: ["large"] }], notes: null,
    collection_mode: "class", payment_method: "cash_on_pickup" });
  expect(screen.getByRole("status")).toHaveTextContent("完成代訂，合計 NT$240。");
});
