import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivityDeadlines from "./ActivityDeadlines";

const api = vi.hoisted(() => ({ listActivities: vi.fn(), updateActivityDeadline: vi.fn(), updateActivityOrderClosure: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
beforeEach(() => {
  vi.resetAllMocks();
  api.listActivities.mockResolvedValue([
    { id: "a", name: "校慶", order_closes_at: "2026-10-22T12:00:00Z" },
    { id: "b", name: "冬季預購", order_closes_at: null },
  ]);
});

describe("活動結單時間設定", () => {
  it("列出多活動，以台北時間儲存並通知商品重新載入", async () => {
    const onSaved = vi.fn();
    render(<ActivityDeadlines onSaved={onSaved} />);
    fireEvent.click(screen.getByText("活動結單與期限"));
    const input = await screen.findByLabelText("校慶停止訂購時間");
    expect(input).toHaveValue("2026-10-22T20:00");
    fireEvent.change(input, { target: { value: "2026-10-23T20:00" } });
    api.updateActivityDeadline.mockResolvedValue({ order_closes_at: "2026-10-23T12:00:00Z" });
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "儲存結單時間" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已儲存活動結單時間");
    expect(api.updateActivityDeadline).toHaveBeenCalledWith("a", "2026-10-23T12:00:00.000Z");
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("冬季預購停止訂購時間")).toHaveValue("");
  });
  it("取消期限送出 null，儲存失敗保留表單並能重試", async () => {
    render(<ActivityDeadlines onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText("活動結單與期限"));
    const input = await screen.findByLabelText("校慶停止訂購時間");
    const form = within(input.closest("form")!);
    fireEvent.click(form.getByRole("button", { name: "清除時間" }));
    api.updateActivityDeadline.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(form.getByRole("button", { name: "儲存結單時間" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("結單時間儲存失敗");
    expect(input).toHaveValue("");
    api.updateActivityDeadline.mockResolvedValue({ order_closes_at: null });
    fireEvent.click(form.getByRole("button", { name: "儲存結單時間" }));
    await waitFor(() => expect(api.updateActivityDeadline).toHaveBeenLastCalledWith("a", null));
    expect(await screen.findByRole("status")).toHaveTextContent("已取消活動統一期限");
  });
  it("載入失敗可重試，空資料提供下一步", async () => {
    api.listActivities.mockRejectedValueOnce(new Error("offline"));
    render(<ActivityDeadlines onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText("活動結單與期限"));
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入活動");
    api.listActivities.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "重新載入活動" }));
    expect(await screen.findByText(/目前沒有可設定的活動/)).toBeVisible();
  });

  it("立即結單後顯示訂單與收款保留，重新開放不清除原期限", async () => {
    const onSaved = vi.fn();
    render(<ActivityDeadlines onSaved={onSaved} />);
    fireEvent.click(screen.getByText("活動結單與期限"));
    const close = await screen.findByRole("button", { name: "立即結單校慶" });
    api.updateActivityOrderClosure.mockResolvedValueOnce({ order_closed_at: "2026-10-27T12:00:00Z" });
    fireEvent.click(close);
    expect(await screen.findByRole("status")).toHaveTextContent("既有訂單保留且可繼續收款");
    expect(api.updateActivityOrderClosure).toHaveBeenCalledWith("a", true);
    expect(screen.getByLabelText("校慶停止訂購時間")).toHaveValue("2026-10-22T20:00");
    api.updateActivityOrderClosure.mockResolvedValueOnce({ order_closed_at: null });
    fireEvent.click(screen.getByRole("button", { name: "重新開放校慶" }));
    expect(await screen.findByRole("status")).toHaveTextContent("訂購仍依原有期限與商品狀態判定");
    expect(api.updateActivityOrderClosure).toHaveBeenLastCalledWith("a", false);
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("結單更新失敗保留原狀態並允許重試", async () => {
    render(<ActivityDeadlines onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText("活動結單與期限"));
    const close = await screen.findByRole("button", { name: "立即結單校慶" });
    api.updateActivityOrderClosure.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(close);
    expect(await screen.findByRole("alert")).toHaveTextContent("活動結單狀態更新失敗");
    expect(close).toBeEnabled();
    expect(screen.queryByRole("button", { name: "重新開放校慶" })).not.toBeInTheDocument();
  });
});
