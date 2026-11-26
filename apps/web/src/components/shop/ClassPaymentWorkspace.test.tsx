import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ClassPaymentWorkspace from "./ClassPaymentWorkspace";

const api = vi.hoisted(() => ({ orderSummary: vi.fn(), setClassPaid: vi.fn(), downloadClassReceipt: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

const summary = (unpaid: number, paid = 0) => ({
  rows: [{ key: "class", label: "一年一班", total_amount: unpaid + paid,
    unpaid_amount: unpaid, paid_amount: paid }],
});
const props = { refreshKey: 0, disabled: false, onChanged: vi.fn(), onBusyChange: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  api.orderSummary.mockResolvedValue(summary(3000));
  api.setClassPaid.mockResolvedValue({});
  api.downloadClassReceipt.mockResolvedValue(new Response("%PDF"));
});

it("lists class-wide product totals and confirms a partial receipt for the whole class", async () => {
  const onViewClass = vi.fn();
  render(<ClassPaymentWorkspace {...props} onViewClass={onViewClass} />);
  await screen.findByRole("button", { name: "核對一年一班收款" });
  expect(api.orderSummary).toHaveBeenCalledExactlyOnceWith({ group_by: "class" });
  expect(screen.getByText("核對收款 NT$3,000")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看一年一班訂購明細" }));
  expect(onViewClass).toHaveBeenCalledExactlyOnceWith("class", "一年一班");

  fireEvent.click(screen.getByRole("button", { name: "核對一年一班收款" }));
  const dialog = screen.getByRole("dialog", { name: "核對全班收款" });
  fireEvent.change(within(dialog).getByRole("spinbutton", { name: "本次實收金額（元）" }), {
    target: { value: "2000" },
  });
  expect(dialog).toHaveTextContent("待補收 NT$1,000");
  fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
  await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledExactlyOnceWith("class", true, {
    received_amount: 2000, expected_unpaid_amount: 3000,
  }));
  expect(await screen.findByText(/剩餘 NT\$1,000 已列入補收款區的整班尾款/)).toBeVisible();
});

it("applies page filters to whole-class rows and ignores stale responses", async () => {
  let resolveAll!: (result: ReturnType<typeof summary>) => void;
  api.orderSummary.mockReturnValueOnce(new Promise((resolve) => { resolveAll = resolve; }))
    .mockResolvedValueOnce(summary(100));
  const { rerender } = render(<ClassPaymentWorkspace {...props} filters={{ product_id: "shirt" }} />);
  rerender(<ClassPaymentWorkspace {...props} filters={{ product_id: "bag" }} />);
  await screen.findByRole("button", { name: "核對一年一班收款" });
  expect(api.orderSummary).toHaveBeenLastCalledWith({ group_by: "class", product_id: "bag" });
  await resolveAll(summary(900));
  expect(screen.getByText("核對收款 NT$3,000")).toBeVisible();
});

it("shows an error with a retry action when class payment totals fail to load", async () => {
  api.orderSummary.mockRejectedValueOnce(new Error("offline"));
  render(<ClassPaymentWorkspace {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("無法載入班級收款金額");
  api.orderSummary.mockResolvedValue(summary(500));
  fireEvent.click(screen.getByRole("button", { name: "重試收款名單" }));
  expect(await screen.findByRole("button", { name: "核對一年一班收款" })).toBeVisible();
});
