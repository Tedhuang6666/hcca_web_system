import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ShopOfficesPanel from "./ShopOfficesPanel";

const api = vi.hoisted(() => ({ offices: vi.fn(), createOffice: vi.fn(), updateOffice: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_error: unknown, fallback: string) => fallback }));
const office = { id: "office", name: "國文科", is_active: true, sort_order: 0 };
beforeEach(() => { vi.resetAllMocks(); api.offices.mockResolvedValue([office]); });

it("allows adding, renaming and disabling the office options teachers use", async () => {
  api.createOffice.mockResolvedValue({ id: "second", name: "學務處", is_active: true, sort_order: 1 });
  api.updateOffice.mockResolvedValueOnce({ ...office, name: "國文辦公室" }).mockResolvedValueOnce({ ...office, name: "國文辦公室", is_active: false });
  render(<ShopOfficesPanel />);
  fireEvent.change(await screen.findByRole("textbox", { name: "新增處室名稱" }), { target: { value: "學務處" } });
  fireEvent.click(screen.getByRole("button", { name: "新增處室" }));
  await screen.findByRole("textbox", { name: "學務處的名稱" });
  fireEvent.change(screen.getByRole("textbox", { name: "國文科的名稱" }), { target: { value: "國文辦公室" } });
  fireEvent.click(screen.getAllByRole("button", { name: "儲存設定" })[0]);
  await screen.findByRole("textbox", { name: "國文辦公室的名稱" });
  fireEvent.change(screen.getByRole("textbox", { name: "國文辦公室的名稱" }), { target: { value: "尚未儲存的名稱" } });
  fireEvent.click(screen.getByRole("button", { name: "停用國文辦公室" }));
  await waitFor(() => expect(api.updateOffice).toHaveBeenLastCalledWith("office", { is_active: false }));
  expect(await screen.findByRole("button", { name: "啟用國文辦公室" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "國文辦公室的名稱" })).toHaveValue("尚未儲存的名稱");
});

it("saves the order and moves the row while preserving another row's draft", async () => {
  const second = { id: "second", name: "學務處", is_active: true, sort_order: 1 };
  api.offices.mockResolvedValue([office, second]);
  let resolveUpdate!: (value: typeof office) => void;
  api.updateOffice.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
  render(<ShopOfficesPanel />);
  fireEvent.change(await screen.findByRole("textbox", { name: "學務處的名稱" }), { target: { value: "未儲存的名稱" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "國文科的顯示順序" }), { target: { value: "5" } });
  const save = screen.getAllByRole("button", { name: "儲存設定" })[0];
  fireEvent.click(save);
  expect(api.updateOffice).toHaveBeenCalledWith("office", { name: "國文科", sort_order: 5 });
  expect(save).toBeDisabled();
  resolveUpdate({ ...office, sort_order: 5 });
  await screen.findByText("名稱與顯示順序已儲存。");
  const rows = screen.getAllByRole("listitem");
  expect(within(rows[0]).getByRole("textbox")).toHaveValue("未儲存的名稱");
  expect(within(rows[1]).getByRole("spinbutton")).toHaveValue(5);
});

it("retains a failed order change for retry and blocks invalid order values", async () => {
  api.updateOffice.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...office, sort_order: 3 });
  render(<ShopOfficesPanel />);
  const order = await screen.findByRole("spinbutton", { name: "國文科的顯示順序" });
  const save = screen.getByRole("button", { name: "儲存設定" });
  for (const value of ["", "-1", "1.5", "2147483648"]) {
    fireEvent.change(order, { target: { value } });
    expect(save).toBeDisabled();
  }
  fireEvent.change(order, { target: { value: "3" } });
  fireEvent.click(save);
  expect(await screen.findByRole("alert")).toHaveTextContent("處室未更新");
  expect(order).toHaveValue(3);
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await screen.findByText("名稱與顯示順序已儲存。");
  expect(save).toBeDisabled();
});

it("keeps equal order values in UUID order when a name changes", async () => {
  api.offices.mockResolvedValue([office, { id: "second", name: "學務處", is_active: true, sort_order: 0 }]);
  api.updateOffice.mockResolvedValue({ ...office, name: "新國文科" });
  render(<ShopOfficesPanel />);
  fireEvent.change(await screen.findByRole("textbox", { name: "國文科的名稱" }), { target: { value: "新國文科" } });
  fireEvent.click(screen.getAllByRole("button", { name: "儲存設定" })[0]);
  await screen.findByRole("textbox", { name: "新國文科的名稱" });
  expect(within(screen.getAllByRole("listitem")[0]).getByRole("textbox")).toHaveValue("新國文科");
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
