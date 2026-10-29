import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SupplementOrders from "./SupplementOrders";

const api = vi.hoisted(() => ({ listSupplementOrders: vi.fn(), setOrderPaid: vi.fn(), rejoinSupplementOrder: vi.fn(), downloadSupplementReceipt: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
const order = { id: "extra", serial_number: "EXTRA-1", user_name: "測試同學", total_price: 120, is_paid: false, is_class_collected: true, supplement_class_id: "class" };
beforeEach(() => {
  vi.clearAllMocks();
  api.listSupplementOrders.mockResolvedValue([order]);
  api.setOrderPaid.mockResolvedValue({ ...order, is_paid: true, class_id: "class" });
  api.rejoinSupplementOrder.mockResolvedValue({ ...order, class_id: "class", is_paid: false });
  api.downloadSupplementReceipt.mockResolvedValue({ blob: async () => new Blob(["receipt"]) });
  URL.createObjectURL = vi.fn(() => "blob:receipt");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

it("lets cadres return an unpaid supplement while preserving its class collection state", async () => {
  const onRejoined = vi.fn();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<SupplementOrders canRejoin onRejoined={onRejoined} />);
  fireEvent.click(await screen.findByRole("button", { name: "併回班級" }));
  await waitFor(() => expect(api.rejoinSupplementOrder).toHaveBeenCalledWith("extra"));
  expect(await screen.findByText(/班代收款紀錄保留，仍待班聯確認繳款/)).toBeVisible();
  expect(onRejoined).toHaveBeenCalledOnce();
  expect(api.setOrderPaid).not.toHaveBeenCalled();
});

it("does not rejoin when the cadre cancels confirmation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<SupplementOrders canRejoin />);
  fireEvent.click(await screen.findByRole("button", { name: "併回班級" }));
  expect(api.rejoinSupplementOrder).not.toHaveBeenCalled();
});

it("confirms a supplement and returns it to the class without downloading a receipt", async () => {
  const onCollected = vi.fn();
  render(<SupplementOrders canCollect onCollected={onCollected} />);
  fireEvent.click(await screen.findByRole("button", { name: "登記繳費" }));
  await waitFor(() => expect(api.setOrderPaid).toHaveBeenCalledWith("extra", true));
  expect(await screen.findByText(/已確認 測試同學的補收款，並歸回原班級/)).toBeVisible();
  expect(api.downloadSupplementReceipt).not.toHaveBeenCalled();
  expect(onCollected).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "下載補收款收據" })).toBeVisible();
});

it("downloads an unpaid receipt without confirming payment and retries a failed download", async () => {
  api.downloadSupplementReceipt.mockRejectedValueOnce(new Error("offline"));
  const onCollected = vi.fn();
  render(<SupplementOrders canCollect onCollected={onCollected} />);
  fireEvent.click(await screen.findByRole("button", { name: "下載補收款收據" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("收據下載失敗");
  fireEvent.click(screen.getByRole("button", { name: "下載補收款收據" }));
  await waitFor(() => expect(api.downloadSupplementReceipt).toHaveBeenCalledTimes(2));
  expect(api.setOrderPaid).not.toHaveBeenCalled();
  expect(onCollected).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "登記繳費" })).toBeVisible();
});

it("shows cadres their outstanding supplements without allowing self confirmation", async () => {
  render(<SupplementOrders />);
  expect(await screen.findByText(/班代已收、待班聯確認繳款/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "登記繳費" })).not.toBeInTheDocument();
});

it("keeps payment registration retryable without downloading when it fails", async () => {
  api.setOrderPaid.mockRejectedValueOnce(new Error("offline"));
  render(<SupplementOrders canCollect />);
  fireEvent.click(await screen.findByRole("button", { name: "登記繳費" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("繳費登記失敗，請重試。");
  fireEvent.click(screen.getByRole("button", { name: "登記繳費" }));
  expect(await screen.findByText(/已確認 測試同學的補收款/)).toBeVisible();
  expect(api.setOrderPaid).toHaveBeenCalledTimes(2);
  expect(api.downloadSupplementReceipt).not.toHaveBeenCalled();
});
