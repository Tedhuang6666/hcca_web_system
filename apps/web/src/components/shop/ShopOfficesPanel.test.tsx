import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ShopOfficesPanel from "./ShopOfficesPanel";

const api = vi.hoisted(() => ({ offices: vi.fn(), createOffice: vi.fn(), updateOffice: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_error: unknown, fallback: string) => fallback }));
const office = { id: "office", name: "國文科", is_active: true };
beforeEach(() => { vi.resetAllMocks(); api.offices.mockResolvedValue([office]); });

it("allows adding, renaming and disabling the office options teachers use", async () => {
  api.createOffice.mockResolvedValue({ id: "second", name: "學務處", is_active: true });
  api.updateOffice.mockResolvedValueOnce({ ...office, name: "國文辦公室" }).mockResolvedValueOnce({ ...office, name: "國文辦公室", is_active: false });
  render(<ShopOfficesPanel />);
  fireEvent.change(await screen.findByRole("textbox", { name: "新增處室名稱" }), { target: { value: "學務處" } });
  fireEvent.click(screen.getByRole("button", { name: "新增處室" }));
  await screen.findByRole("textbox", { name: "學務處的名稱" });
  fireEvent.change(screen.getByRole("textbox", { name: "國文科的名稱" }), { target: { value: "國文辦公室" } });
  fireEvent.click(screen.getAllByRole("button", { name: "儲存名稱" })[0]);
  await screen.findByRole("textbox", { name: "國文辦公室的名稱" });
  fireEvent.change(screen.getByRole("textbox", { name: "國文辦公室的名稱" }), { target: { value: "尚未儲存的名稱" } });
  fireEvent.click(screen.getByRole("button", { name: "停用國文辦公室" }));
  await waitFor(() => expect(api.updateOffice).toHaveBeenLastCalledWith("office", { is_active: false }));
  expect(await screen.findByRole("button", { name: "啟用國文辦公室" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "國文辦公室的名稱" })).toHaveValue("尚未儲存的名稱");
});

it("retries loading and preserves a failed new option", async () => {
  api.offices.mockRejectedValueOnce(new Error("offline"));
  api.createOffice.mockRejectedValue(new Error("duplicate"));
  render(<ShopOfficesPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "重新載入處室" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "新增處室名稱" }), { target: { value: "國文科" } });
  fireEvent.click(screen.getByRole("button", { name: "新增處室" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("處室未新增");
  expect(screen.getByRole("textbox", { name: "新增處室名稱" })).toHaveValue("國文科");
});
