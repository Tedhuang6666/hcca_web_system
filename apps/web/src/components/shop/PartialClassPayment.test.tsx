import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ClassPaymentWorkspace from "./ClassPaymentWorkspace";
import SupplementOrders from "./SupplementOrders";
import type { ActivityOut, OrderListItem } from "@/lib/types";

const api = vi.hoisted(() => ({ orderSummary: vi.fn(), setClassPaid: vi.fn(), listSupplementOrders: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
const activity = { id: "festival", name: "校慶" } as ActivityOut;

beforeEach(() => {
  vi.resetAllMocks();
  api.orderSummary.mockResolvedValue({ rows: [{ key: "class", label: "一年一班", total_amount: 3000, paid_amount: 0, unpaid_amount: 3000 }] });
  api.setClassPaid.mockResolvedValue({});
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it("輸入本次實收，預告整班尾款並傳送核對金額", async () => {
  await act(async () => { render(<ClassPaymentWorkspace catalog={[]} activities={[activity]} optionsLoading={false} optionsError={false}
    refreshKey={0} disabled={false} onChanged={vi.fn()} onBusyChange={vi.fn()} selectedScopeKey="festival" />); });
  fireEvent.click(await screen.findByRole("button", { name: "核對一年一班收款" }));
  const dialog = screen.getByRole("dialog", { name: "核對班級收款" });
  fireEvent.change(within(dialog).getByRole("spinbutton", { name: "本次實收金額（元）" }), { target: { value: "2000" } });
  expect(dialog).toHaveTextContent("待補收 NT$1,000");
  fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
  await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledWith("class", true, "festival", undefined,
    { received_amount: 2000, expected_unpaid_amount: 3000 }));
  expect(await screen.findByText(/剩餘 NT\$1,000 已列入補收款區的整班尾款/)).toBeVisible();
});

it.each(["0", "3001", "2000.5", ""])("拒絕無效的實收金額 %s", async (amount) => {
  await act(async () => { render(<ClassPaymentWorkspace catalog={[]} activities={[activity]} optionsLoading={false} optionsError={false}
    refreshKey={0} disabled={false} onChanged={vi.fn()} onBusyChange={vi.fn()} selectedScopeKey="festival" />); });
  fireEvent.click(await screen.findByRole("button", { name: "核對一年一班收款" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "本次實收金額（元）" }), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: "確認收到款項" }));
  expect(screen.getByRole("alert")).toHaveTextContent("請輸入大於零");
  expect(api.setClassPaid).not.toHaveBeenCalled();
});

it("補收區按班級合併尾款，合計只計差額並整班補齊", async () => {
  const base = { class_id: "class", supplement_class_id: "class", class_label: "一年一班", activity_id: "festival",
    activity_name: "校慶", is_class_balance: true, is_paid: false };
  api.listSupplementOrders.mockResolvedValueOnce([
    { ...base, id: "one", total_price: 2000, received_amount: 1500, user_name: "學生甲" },
    { ...base, id: "two", total_price: 1000, received_amount: 500, user_name: "學生乙" },
  ] as OrderListItem[]).mockResolvedValue([]);
  render(<SupplementOrders canCollect />);
  const balances = await screen.findByRole("list", { name: "整班尾款" });
  expect(balances).toHaveTextContent("一年一班 · 整班尾款");
  expect(balances).not.toHaveTextContent("學生甲");
  expect(screen.getByText("待補收 NT$1,000")).toBeVisible();
  fireEvent.click(within(balances).getByRole("button", { name: "收齊尾款 NT$1,000" }));
  await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledWith("class", true, "festival", undefined,
    { expected_unpaid_amount: 1000 }));
  expect(await screen.findByText("已收齊該班的整班尾款。")).toBeVisible();
});
