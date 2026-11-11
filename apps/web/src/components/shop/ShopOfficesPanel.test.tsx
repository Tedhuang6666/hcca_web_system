import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShopOfficesPanel from "./ShopOfficesPanel";

const api = vi.hoisted(() => ({ offices: vi.fn(), createOffice: vi.fn(), updateOffice: vi.fn(), reorderOffices: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_error: unknown, fallback: string) => fallback }));
const office = { id: "office", name: "國文科", is_active: true, sort_order: 0 };
const second = { id: "second", name: "學務處", is_active: true, sort_order: 1 };
beforeEach(() => {
  vi.resetAllMocks(); api.offices.mockResolvedValue([office]);
  // jsdom 沒有版面座標，提供列的位置讓真正的 keyboard sensor 可判斷上下移動。
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.closest("li");
    const index = row?.parentElement ? Array.from(row.parentElement.children).indexOf(row) : 0;
    return DOMRect.fromRect({ x: 0, y: index * 100, width: 700, height: 100 });
  });
});
afterEach(() => vi.restoreAllMocks());

async function moveFirstOffice() {
  const user = userEvent.setup();
  const handle = await screen.findByRole("button", { name: "拖曳排序：國文科" });
  handle.focus();
  await user.keyboard("[Space]");
  await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));
  await user.keyboard("[ArrowDown]");
  await screen.findByText("「國文科」將移至第 2 個位置。");
  await user.keyboard("[Space]");
}

it("allows adding, renaming and disabling offices without numeric order fields", async () => {
  api.createOffice.mockResolvedValue(second);
  api.updateOffice.mockResolvedValueOnce({ ...office, name: "國文辦公室" }).mockResolvedValueOnce({ ...office, name: "國文辦公室", is_active: false });
  render(<ShopOfficesPanel />);
  fireEvent.change(await screen.findByRole("textbox", { name: "新增處室名稱" }), { target: { value: "學務處" } });
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "新增處室" }));
  await screen.findByRole("textbox", { name: "學務處的名稱" });
  fireEvent.change(screen.getByRole("textbox", { name: "國文科的名稱" }), { target: { value: "國文辦公室" } });
  fireEvent.click(screen.getAllByRole("button", { name: "儲存名稱" })[0]);
  await screen.findByRole("textbox", { name: "國文辦公室的名稱" });
  expect(api.updateOffice).toHaveBeenCalledWith("office", { name: "國文辦公室" });
  fireEvent.change(screen.getByRole("textbox", { name: "國文辦公室的名稱" }), { target: { value: "尚未儲存的名稱" } });
  fireEvent.click(screen.getByRole("button", { name: "停用國文辦公室" }));
  await waitFor(() => expect(api.updateOffice).toHaveBeenLastCalledWith("office", { is_active: false }));
  expect(await screen.findByRole("button", { name: "啟用國文辦公室" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "國文辦公室的名稱" })).toHaveValue("尚未儲存的名稱");
});

it("saves keyboard drag order in one request and preserves other drafts", async () => {
  api.offices.mockResolvedValue([office, second]);
  let resolveOrder!: (value: typeof office[]) => void;
  api.reorderOffices.mockReturnValue(new Promise((resolve) => { resolveOrder = resolve; }));
  const { unmount } = render(<ShopOfficesPanel />);
  fireEvent.change(await screen.findByRole("textbox", { name: "學務處的名稱" }), { target: { value: "未儲存的名稱" } });
  await moveFirstOffice();
  expect(api.reorderOffices).toHaveBeenCalledExactlyOnceWith({ office_ids: ["second", "office"] });
  expect(api.updateOffice).not.toHaveBeenCalled();
  expect(within(screen.getAllByRole("listitem")[0]).getByRole("textbox")).toHaveValue("未儲存的名稱");
  expect(screen.getByRole("button", { name: "拖曳排序：國文科" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "新增處室名稱" })).toBeDisabled();
  const ordered = [{ ...second, sort_order: 0 }, { ...office, sort_order: 1 }];
  resolveOrder(ordered);
  await screen.findByText("處室順序已儲存。");
  await waitFor(() => expect(screen.getByRole("button", { name: "拖曳排序：國文科" })).toHaveFocus());
  expect(screen.getByRole("textbox", { name: "學務處的名稱" })).toHaveValue("未儲存的名稱");
  unmount();
  api.offices.mockResolvedValue(ordered);
  render(<ShopOfficesPanel />);
  await screen.findByRole("textbox", { name: "學務處的名稱" });
  expect(within(screen.getAllByRole("listitem")[0]).getByRole("textbox")).toHaveValue("學務處");
});

it("restores the order after failure, retains drafts and allows a new drag", async () => {
  api.offices.mockResolvedValue([office, second]);
  api.reorderOffices.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([second, office]);
  render(<ShopOfficesPanel />);
  fireEvent.change(await screen.findByRole("textbox", { name: "學務處的名稱" }), { target: { value: "保留草稿" } });
  await moveFirstOffice();
  expect(await screen.findByRole("alert")).toHaveTextContent("無法儲存處室順序");
  expect(within(screen.getAllByRole("listitem")[0]).getByRole("textbox")).toHaveValue("國文科");
  expect(screen.getByRole("textbox", { name: "學務處的名稱" })).toHaveValue("保留草稿");
  await moveFirstOffice();
  await screen.findByText("處室順序已儲存。");
  expect(api.reorderOffices).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("cancels keyboard dragging without saving and disables a lone handle", async () => {
  api.offices.mockResolvedValue([office, second]);
  render(<ShopOfficesPanel />);
  const user = userEvent.setup();
  const handle = await screen.findByRole("button", { name: "拖曳排序：國文科" });
  handle.focus();
  await user.keyboard("[Space]");
  await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));
  await user.keyboard("[ArrowDown][Escape]");
  expect(api.reorderOffices).not.toHaveBeenCalled();
  expect(within(screen.getAllByRole("listitem")[0]).getByRole("textbox")).toHaveValue("國文科");
});

it("keeps a single office usable and reports an empty list", async () => {
  const { unmount } = render(<ShopOfficesPanel />);
  expect(await screen.findByRole("button", { name: "拖曳排序：國文科" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "國文科的名稱" })).toBeEnabled();
  unmount();
  api.offices.mockResolvedValue([]);
  render(<ShopOfficesPanel />);
  await screen.findByText("尚未設定處室，請先新增老師可選的選項。");
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

it("retries loading and preserves a failed new office", async () => {
  api.offices.mockRejectedValueOnce(new Error("offline"));
  api.createOffice.mockRejectedValue(new Error("duplicate"));
  render(<ShopOfficesPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "重新載入處室" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "新增處室名稱" }), { target: { value: "國文科" } });
  fireEvent.click(screen.getByRole("button", { name: "新增處室" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("處室未新增");
  expect(screen.getByRole("textbox", { name: "新增處室名稱" })).toHaveValue("國文科");
});
