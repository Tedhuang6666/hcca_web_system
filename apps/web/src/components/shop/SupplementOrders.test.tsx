import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SupplementOrders from "./SupplementOrders";

const api = vi.hoisted(() => ({ listSupplementOrders: vi.fn(), setOrderPaid: vi.fn(), downloadSupplementReceipt: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
const order = { id: "extra", serial_number: "EXTRA-1", user_name: "測試同學", total_price: 120, is_paid: false, supplement_class_id: "class" };
beforeEach(() => {
  vi.clearAllMocks();
  api.listSupplementOrders.mockResolvedValue([order]);
  api.setOrderPaid.mockResolvedValue({ ...order, is_paid: true, class_id: "class" });
  api.downloadSupplementReceipt.mockResolvedValue({ blob: async () => new Blob(["receipt"]) });
  URL.createObjectURL = vi.fn(() => "blob:receipt");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

it("confirms a supplement, returns it to the class and downloads its receipt", async () => {
  const onCollected = vi.fn();
  render(<SupplementOrders canCollect onCollected={onCollected} />);
  fireEvent.click(await screen.findByRole("button", { name: "確認收款並下載收據" }));
  await waitFor(() => expect(api.setOrderPaid).toHaveBeenCalledWith("extra", true));
  expect(await screen.findByText(/已確認 測試同學的補收款，並歸回原班級/)).toBeVisible();
  expect(api.downloadSupplementReceipt).toHaveBeenCalledWith("extra");
  expect(onCollected).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "下載補收款收據" })).toBeVisible();
});

it("keeps confirmed payment when receipt download fails and retries only the receipt", async () => {
  api.downloadSupplementReceipt.mockRejectedValueOnce(new Error("offline"));
  render(<SupplementOrders canCollect />);
  fireEvent.click(await screen.findByRole("button", { name: "確認收款並下載收據" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("款項已確認；收據下載失敗");
  fireEvent.click(screen.getByRole("button", { name: "下載補收款收據" }));
  await waitFor(() => expect(api.downloadSupplementReceipt).toHaveBeenCalledTimes(2));
  expect(api.setOrderPaid).toHaveBeenCalledOnce();
});

it("shows cadres their outstanding supplements without allowing self confirmation", async () => {
  render(<SupplementOrders />);
  expect(await screen.findByText(/待代訂人繳款/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "確認收款並下載收據" })).not.toBeInTheDocument();
});
