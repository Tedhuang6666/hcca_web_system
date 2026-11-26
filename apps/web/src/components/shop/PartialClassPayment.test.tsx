import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ClassPaymentWorkspace from "./ClassPaymentWorkspace";
import SupplementOrders from "./SupplementOrders";
import type { OrderListItem } from "@/lib/types";

const api = vi.hoisted(() => ({ orderSummary: vi.fn(), setClassPaid: vi.fn(), setOrderPaid: vi.fn(), listSupplementOrders: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

beforeEach(() => {
  vi.resetAllMocks();
  api.orderSummary.mockResolvedValue({ rows: [{ key: "class", label: "一年一班", total_amount: 3000, paid_amount: 0, unpaid_amount: 3000 }] });
  api.setClassPaid.mockResolvedValue({});
  api.setOrderPaid.mockResolvedValue({});
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it("輸入本次實收，預告整班尾款並傳送核對金額", async () => {
  await act(async () => { render(<ClassPaymentWorkspace refreshKey={0} disabled={false}
    onChanged={vi.fn()} onBusyChange={vi.fn()} />); });
  fireEvent.click(await screen.findByRole("button", { name: "核對一年一班收款" }));
  const dialog = screen.getByRole("dialog", { name: "核對全班收款" });
  fireEvent.change(within(dialog).getByRole("spinbutton", { name: "本次實收金額（元）" }), { target: { value: "2000" } });
  expect(dialog).toHaveTextContent("待補收 NT$1,000");
  fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
  await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledWith("class", true,
    { received_amount: 2000, expected_unpaid_amount: 3000 }));
  expect(await screen.findByText(/剩餘 NT\$1,000 已列入補收款區的整班尾款/)).toBeVisible();
});

it.each(["0", "3001", "2000.5", ""])("拒絕無效的實收金額 %s", async (amount) => {
  await act(async () => { render(<ClassPaymentWorkspace refreshKey={0} disabled={false}
    onChanged={vi.fn()} onBusyChange={vi.fn()} />); });
  fireEvent.click(await screen.findByRole("button", { name: "核對一年一班收款" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "本次實收金額（元）" }), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: "確認收到款項" }));
  expect(screen.getByRole("alert")).toHaveTextContent("請輸入大於零");
  expect(api.setClassPaid).not.toHaveBeenCalled();
});

it("補收區按班級合併尾款，合計只計差額並整班補齊", async () => {
  const base = { class_id: "class", supplement_class_id: "class", class_label: "一年一班",
    category_id: "festival", category_name: "校慶商品", is_class_balance: true, is_paid: false };
  api.listSupplementOrders.mockResolvedValueOnce([
    { ...base, id: "one", serial_number: "1", status: "pending", total_price: 2000, subtotal_price: 2000,
      discount_amount: 0, received_amount: 1500, user_name: "學生甲", user_id: "user-1", assistance_scope: "self",
      payment_method: "cash_on_pickup", created_at: "2026-11-01T00:00:00Z", is_class_collected: false },
    { ...base, id: "two", serial_number: "2", status: "pending", total_price: 1000, subtotal_price: 1000,
      discount_amount: 0, received_amount: 500, user_name: "學生乙", user_id: "user-2", assistance_scope: "self",
      payment_method: "cash_on_pickup", created_at: "2026-11-01T00:00:00Z", is_class_collected: false },
  ] satisfies OrderListItem[]).mockResolvedValue([]);
  render(<SupplementOrders canCollect />);
  const balances = await screen.findByRole("list", { name: "整班尾款" });
  expect(balances).toHaveTextContent("一年一班 · 整班尾款");
  expect(balances).not.toHaveTextContent("學生甲");
  expect(screen.getByText("待補收 NT$1,000")).toBeVisible();
  fireEvent.click(within(balances).getByRole("button", { name: "收齊尾款 NT$1,000" }));
  await waitFor(() => expect(api.setOrderPaid).toHaveBeenCalledTimes(2));
  expect(api.setOrderPaid).toHaveBeenNthCalledWith(1, "one", true);
  expect(api.setOrderPaid).toHaveBeenNthCalledWith(2, "two", true);
  expect(await screen.findByText("已收齊該班的整班尾款。")).toBeVisible();
});
