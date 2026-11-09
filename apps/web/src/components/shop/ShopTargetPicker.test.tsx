import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ShopTargetOut } from "@/lib/types";
import ShopTargetPicker from "./ShopTargetPicker";

const api = vi.hoisted(() => ({ lookupTargets: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
const people: ShopTargetOut[] = [
  { identifier: "310001", display_name: "測試同名", student_id: "310001", class_label: "三年一班", seat_number: 1, matched: true, account_active: true },
  { identifier: "310002", display_name: "測試同名", student_id: "310002", class_label: "三年二班", seat_number: 2, matched: true, account_active: null },
];
function Picker({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState(initial);
  return <><ShopTargetPicker label="允許名單" value={value} onChange={setValue} activityId="activity" help="限定名單內人員" />
    <output data-testid="selected">{JSON.stringify(value)}</output></>;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.lookupTargets.mockImplementation(async ({ identifiers }: { identifiers?: string[] }) => identifiers
    ? identifiers.map((identifier) => people.find((person) => person.identifier === identifier) ?? { identifier, matched: false })
    : people);
});

it("以姓名搜尋，依班級學號確認同名者，加入與移除只儲存識別碼", async () => {
  render(<Picker />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "測試同名" } });
  expect(screen.getByText("正在搜尋人員…")).toBeVisible();
  const button = await screen.findByRole("button", { name: /加入 測試同名（學號 310002 · 三年二班 · 2 號）/ });
  fireEvent.click(button);
  expect(screen.getByTestId("selected")).toHaveTextContent('["310002"]');
  const selected = screen.getByRole("list", { name: "允許名單已選名單" });
  expect(await within(selected).findByText("測試同名")).toBeVisible();
  expect(within(selected).getByText("尚未註冊帳號")).toBeVisible();
  expect(button).toBeDisabled();
  fireEvent.click(within(selected).getByRole("button", { name: /移除 測試同名/ }));
  expect(screen.getByTestId("selected")).toHaveTextContent("[]");
});

it("批次貼上後去除重複並核對姓名，查無資料時保留可預先指定的學號", async () => {
  render(<Picker />);
  fireEvent.click(screen.getByText("批次輸入學號或 Email"));
  fireEvent.change(screen.getByRole("textbox", { name: "允許名單（批次輸入）" }), { target: { value: "310001，310001\n399999" } });
  expect(await screen.findByText("測試同名")).toBeVisible();
  expect(screen.getByTestId("selected")).toHaveTextContent('["310001","399999"]');
  expect(screen.getByText(/1 筆查無人員資料/)).toBeVisible();
  expect(api.lookupTargets).toHaveBeenCalledWith({ activity_id: "activity", keyword: "", identifiers: ["310001", "399999"] });
});

it("核對失敗保留既有名單，重試後恢復姓名資訊", async () => {
  api.lookupTargets.mockRejectedValueOnce(new Error("offline"));
  render(<Picker initial={["310001"]} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("輸入內容已保留");
  expect(screen.getByTestId("selected")).toHaveTextContent('["310001"]');
  fireEvent.click(screen.getByRole("button", { name: "重新核對" }));
  expect(await screen.findByText("測試同名")).toBeVisible();
});

it("搜尋無結果有下一步，較舊的搜尋回應不會覆蓋新結果", async () => {
  let finishOld!: (rows: ShopTargetOut[]) => void;
  api.lookupTargets.mockReturnValueOnce(new Promise<ShopTargetOut[]>((resolve) => { finishOld = resolve; }));
  api.lookupTargets.mockResolvedValueOnce([]);
  render(<Picker />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "舊名字" } });
  await waitFor(() => expect(api.lookupTargets).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "新名字" } });
  expect(await screen.findByText(/找不到相符人員/)).toBeVisible();
  await act(async () => finishOld(people));
  expect(screen.queryByRole("button", { name: /加入 測試同名/ })).not.toBeInTheDocument();
});

function ProductPicker({ initialNotes = {}, identifiers = ["310001", "310002"] }: {
  initialNotes?: Record<string, string>; identifiers?: string[];
}) {
  const [value, setValue] = useState(identifiers);
  const [notes, setNotes] = useState(initialNotes);
  return <><ShopTargetPicker label="商品允許名單" value={value} onChange={setValue} productId="product"
    notes={notes} onNotesChange={setNotes} help="商品名單" />
    <output data-testid="notes">{JSON.stringify(notes)}</output></>;
}

it("依此商品訂購狀態篩選，單筆與批次備註只影響勾選人員", async () => {
  api.lookupTargets.mockResolvedValue(people.map((person, index) => ({ ...person, has_ordered: index === 0 })));
  render(<ProductPicker initialNotes={{ "310001": "原備註" }} />);
  expect(await screen.findByText("已訂購")).toBeVisible();
  expect(screen.getByText("未訂購")).toBeVisible();
  expect(api.lookupTargets).toHaveBeenCalledWith({ activity_id: null, product_id: "product", keyword: "", identifiers: ["310001", "310002"] });
  fireEvent.change(screen.getByRole("textbox", { name: "商品允許名單：310002 的備註" }), { target: { value: "個別備註" } });
  fireEvent.click(screen.getByText("批次編輯備註"));
  fireEvent.click(screen.getByRole("checkbox", { name: "勾選目前篩選結果（2 人）" }));
  fireEvent.change(screen.getByRole("combobox", { name: "訂購狀態" }), { target: { value: "ordered" } });
  expect(screen.getByText(/已勾選 0 人/)).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "商品允許名單：310002 的備註" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "勾選目前篩選結果（1 人）" }));
  fireEvent.change(screen.getByRole("textbox", { name: "批次備註（每人最多 500 字）" }), { target: { value: "已聯絡" } });
  fireEvent.click(screen.getByRole("button", { name: "套用至勾選人員" }));
  expect(JSON.parse(screen.getByTestId("notes").textContent!)).toEqual({ "310001": "原備註\n已聯絡", "310002": "個別備註" });
  fireEvent.change(screen.getByRole("combobox", { name: "訂購狀態" }), { target: { value: "unordered" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "勾選目前篩選結果（1 人）" }));
  fireEvent.change(screen.getByRole("combobox", { name: "備註套用方式" }), { target: { value: "replace" } });
  fireEvent.change(screen.getByRole("textbox", { name: "批次備註（每人最多 500 字）" }), { target: { value: "取代備註" } });
  fireEvent.click(screen.getByRole("button", { name: "套用至勾選人員" }));
  expect(JSON.parse(screen.getByTestId("notes").textContent!)["310002"]).toBe("取代備註");
  fireEvent.click(screen.getByRole("checkbox", { name: "勾選目前篩選結果（1 人）" }));
  fireEvent.click(screen.getByRole("button", { name: "清除勾選人員備註" }));
  expect(JSON.parse(screen.getByTestId("notes").textContent!)).toEqual({ "310001": "原備註\n已聯絡" });
});

it("核對失敗不誤標未訂購，重試後可顯示篩選空狀態", async () => {
  api.lookupTargets.mockRejectedValueOnce(new Error("offline"));
  render(<ProductPicker />);
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("未訂購")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "訂購狀態" })).toBeDisabled();
  api.lookupTargets.mockResolvedValue(people.map((person) => ({ ...person, has_ordered: true })));
  fireEvent.click(screen.getByRole("button", { name: "重新核對" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "訂購狀態" })).toBeEnabled());
  fireEvent.change(screen.getByRole("combobox", { name: "訂購狀態" }), { target: { value: "unordered" } });
  expect(screen.getByText(/此狀態沒有符合的人員/)).toBeVisible();
});

it("批次附加超長時保留所有原備註，超過首批 50 人也能完整套用", async () => {
  const identifiers = Array.from({ length: 51 }, (_, index) => String(310001 + index));
  api.lookupTargets.mockImplementation(async ({ identifiers }: { identifiers: string[] }) => identifiers.map((identifier) => ({ identifier, has_ordered: false })));
  render(<ProductPicker identifiers={identifiers} initialNotes={{ "310001": "字".repeat(499) }} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "訂購狀態" })).toBeEnabled());
  fireEvent.click(screen.getByText("批次編輯備註"));
  fireEvent.click(screen.getByRole("checkbox", { name: "勾選目前篩選結果（51 人）" }));
  const input = screen.getByRole("textbox", { name: "批次備註（每人最多 500 字）" });
  fireEvent.change(input, { target: { value: "新備註" } });
  fireEvent.click(screen.getByRole("button", { name: "套用至勾選人員" }));
  expect(screen.getByText(/附加後有備註超過 500 字/)).toBeVisible();
  expect(Object.keys(JSON.parse(screen.getByTestId("notes").textContent!))).toHaveLength(1);
  fireEvent.change(screen.getByRole("combobox", { name: "備註套用方式" }), { target: { value: "replace" } });
  fireEvent.click(screen.getByRole("button", { name: "套用至勾選人員" }));
  expect(Object.values(JSON.parse(screen.getByTestId("notes").textContent!))).toEqual(Array(51).fill("新備註"));
});
