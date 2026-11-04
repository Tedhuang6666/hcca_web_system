import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import CouncilClassOrders from "./CouncilClassOrders";
import type { CatalogCategoryOut, ClassMemberOut, OrderListItem } from "@/lib/types";

const api = vi.hoisted(() => ({ listOrders: vi.fn(), listOrderRecipients: vi.fn(), listSupplementOrders: vi.fn(),
  getProduct: vi.fn(), createAdminAssistedOrder: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
const members: ClassMemberOut[] = [
  { id: "member-1", user_id: "user-1", roster_entry_id: null, display_name: "測試同學甲", student_id: "11501", seat_number: 1, email: "", is_cadre: false, source: "range" },
  { id: "member-2", user_id: null, roster_entry_id: "roster-2", display_name: "名冊同學乙", student_id: "11502", seat_number: 2, email: "", is_cadre: false, source: "roster" },
];
const catalog: CatalogCategoryOut[] = [{ id: "cat", name: "紀念品", sort_order: 0, series: [], products: [
  { id: "shirt", name: "紀念衫", price: 100, status: "active", stock_quantity: 10, is_unlimited: false, has_variants: true, has_option_surcharge: false, requires_seating: false, purchase_allowed: true },
] }];
const order = (changes: Partial<OrderListItem> = {}): OrderListItem => ({
  id: "order-1", serial_number: "ORD-001", user_id: "user-1", user_name: "測試同學甲", class_id: "class-1",
  assistance_scope: "self", discount_amount: 0, payment_method: "cash_on_pickup", subtotal_price: 200,
  status: "pending", total_price: 200, is_paid: false, is_class_collected: false, created_at: "2026-11-02T00:00:00Z",
  activity_name: "校慶", items: [{ id: "item-1", product_id: "shirt", product_name: "紀念衫", quantity: 2,
    unit_price: 100, subtotal: 200, selected_options: [{ group_id: "size", group_name: "尺寸", option_id: "large", value: "L", price_delta: 0 }] }],
  ...changes,
});
const onCreated = vi.fn();
const onClose = vi.fn();
function view(canOrder = true, id = "class-1") {
  return <CouncilClassOrders target={{ id, label: "一年一班" }} catalog={catalog}
    classes={[{ id: "class-1", label: "一年一班", academic_year: 115, class_code: "101", grade: 1, is_active: true }]}
    canOrder={canOrder} optionsError={false} optionsLoading={false} onRetryOptions={vi.fn()}
    onCreated={onCreated} onClose={onClose} />;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.listOrders.mockResolvedValue([order()]);
  api.listOrderRecipients.mockResolvedValue(members);
  api.listSupplementOrders.mockResolvedValue([]);
  api.getProduct.mockResolvedValue({ id: "shirt", name: "紀念衫", status: "active", price: 100,
    variant_groups: [{ id: "size", name: "尺寸", options: [{ id: "large", value: "L", price_delta: 0, is_active: true }] }] });
  api.createAdminAssistedOrder.mockResolvedValue([{ total_price: 100 }]);
});

it("從收款活動進入明細時，訂單、補收與合計僅包含該活動", async () => {
  api.listOrders.mockResolvedValue([
    order({ category_id: "cat", activity_name: null, category_name: "紀念品" }),
    order({ id: "other", category_id: "other", total_price: 900, activity_name: "另一活動" }),
  ]);
  api.listSupplementOrders.mockResolvedValue([
    order({ id: "other-supplement", category_id: "other", class_id: null, supplement_class_id: "class-1", total_price: 900 }),
  ]);
  render(<CouncilClassOrders target={{ id: "class-1", label: "一年一班", scope: { key: "category:cat", label: "紀念品" } }}
    catalog={catalog} classes={[]} canOrder optionsLoading={false} optionsError={false}
    onRetryOptions={vi.fn()} onCreated={onCreated} onClose={onClose} />);
  expect(await screen.findByText("1 人已訂購 · 共 2 件 · 合計 NT$200")).toBeVisible();
  expect(screen.queryByText(/另一活動/)).not.toBeInTheDocument();
  expect(api.listOrders).toHaveBeenCalledWith(expect.objectContaining({ category_id: "cat", general_only: "true" }));
});

it("列出全班與未訂購者，合併品項數量、排除取消並標示本班補收", async () => {
  api.listOrders.mockResolvedValue([order(), order({ id: "order-2", is_class_collected: true }), order({ id: "cancelled", status: "cancelled" })]);
  api.listSupplementOrders.mockResolvedValue([
    order({ id: "supplement", class_id: null, supplement_class_id: "class-1" }),
    order({ id: "other-class", class_id: null, supplement_class_id: "class-2", user_name: "他班同學" }),
  ]);
  render(view());
  const student = await screen.findByRole("listitem", { name: "測試同學甲的訂購明細" });
  expect(within(student).getByText("校慶 · 紀念衫（尺寸：L） × 4")).toBeVisible();
  expect(within(student).getByText("獨立補收")).toBeVisible();
  expect(within(student).getByText("共 6 件 · 合計 NT$600 · 待繳 NT$400")).toBeVisible();
  expect(within(screen.getByRole("listitem", { name: "名冊同學乙的訂購明細" })).getByText("尚未訂購")).toBeVisible();
  expect(screen.queryByText("他班同學")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "11502" } });
  expect(screen.queryByRole("listitem", { name: "測試同學甲的訂購明細" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "替名冊同學乙快捷加購" })).toBeVisible();
});

it("快捷加購預選並固定班級與同學，送出後刷新明細及統計", async () => {
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: "替名冊同學乙快捷加購" }));
  await screen.findByRole("option", { name: /名冊同學乙/ });
  expect(screen.getByRole("combobox", { name: "代訂班級" })).toHaveValue("class-1");
  expect(screen.getByRole("combobox", { name: "代訂班級" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "代訂同學" })).toHaveValue("member-2");
  expect(screen.getByRole("combobox", { name: "代訂同學" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "代訂商品" }), { target: { value: "shirt" } });
  fireEvent.change(await screen.findByRole("combobox", { name: "尺寸（必選）" }), { target: { value: "large" } });
  fireEvent.click(screen.getByRole("button", { name: "加入代訂清單" }));
  api.listOrders.mockResolvedValue([order({ user_id: "user-2", user_name: "名冊同學乙" })]);
  api.listOrderRecipients.mockResolvedValue([members[0], { ...members[1], user_id: "user-2" }]);
  fireEvent.click(screen.getByRole("button", { name: "送出代訂" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(api.createAdminAssistedOrder).toHaveBeenCalledWith(expect.objectContaining({ roster_entry_id: "roster-2",
    items: [{ product_id: "shirt", quantity: 1, option_ids: ["large"] }] }));
  fireEvent.click(screen.getByRole("button", { name: /返回明細/ }));
  expect(await screen.findByRole("listitem", { name: "名冊同學乙的訂購明細" })).toHaveTextContent("共 2 件");
});

it("唯讀不呼叫管理名冊或補收 API，且不提供加購", async () => {
  render(view(false));
  expect(await screen.findByRole("listitem", { name: "測試同學甲的訂購明細" })).toBeVisible();
  expect(api.listOrderRecipients).not.toHaveBeenCalled();
  expect(api.listSupplementOrders).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /快捷加購/ })).not.toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "搜尋同學姓名" })).toBeVisible();
});

it("分頁讀完超過 500 筆訂單並呈現真實總量", async () => {
  api.listOrders.mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => order({ id: `order-${index}` })))
    .mockResolvedValueOnce([order({ id: "last" })]);
  render(view(false));
  expect(await screen.findByText("1 人已訂購 · 共 1002 件 · 合計 NT$100,200")).toBeVisible();
  expect(api.listOrders).toHaveBeenLastCalledWith({ my_only: "false", class_id: "class-1", limit: "500", offset: "500" });
});

it("載入失敗可重試，空資料與搜尋無結果有回饋", async () => {
  api.listOrders.mockRejectedValueOnce(new Error("offline"));
  render(view());
  expect(await screen.findByRole("alert")).toHaveTextContent("無法載入班級訂購明細");
  api.listOrders.mockResolvedValue([]);
  api.listOrderRecipients.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "重試班級明細" }));
  expect(await screen.findByText("此班尚無名冊或有效訂購。")).toBeVisible();
});

it("切換班級時忽略前一班較慢的回應", async () => {
  let resolve: (orders: OrderListItem[]) => void = vi.fn();
  api.listOrders.mockReturnValueOnce(new Promise<OrderListItem[]>((done) => { resolve = done; }));
  const rendered = render(view(false));
  expect(screen.getByText("正在載入班級訂購明細…")).toBeVisible();
  api.listOrders.mockResolvedValue([]);
  rendered.rerender(view(false, "class-2"));
  await screen.findByText("此班尚無名冊或有效訂購。");
  await act(async () => resolve([order()]));
  expect(screen.queryByRole("listitem", { name: "測試同學甲的訂購明細" })).not.toBeInTheDocument();
});
