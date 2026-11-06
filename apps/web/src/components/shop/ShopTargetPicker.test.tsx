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
