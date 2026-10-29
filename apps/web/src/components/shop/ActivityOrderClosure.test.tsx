import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivityOrderClosure from "./ActivityOrderClosure";

const api = vi.hoisted(() => ({ getCloseStatus: vi.fn(), closeCategory: vi.fn(), reopenCategory: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

const categories = [{ id: "a", name: "校慶預購" }];

function ClosureSettings({ onSaved = vi.fn() }: { onSaved?: () => void }) {
  return <ActivityOrderClosure categories={categories} onSaved={onSaved} />;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getCloseStatus.mockResolvedValue({ statuses: { a: { is_closed: false }, b: { is_closed: false } } });
  api.closeCategory.mockResolvedValue({});
  api.reopenCategory.mockResolvedValue({});
});

describe("商品批次全域鎖單", () => {
  it("直接鎖住商品批次，重新開放不傳班級或改動期限", async () => {
    const onSaved = vi.fn();
    render(<ClosureSettings onSaved={onSaved} />);
    expect(screen.getByRole("heading", { name: "活動結單與公開入口" })).toBeVisible();
    await screen.findByText("尚未結單");
    expect(api.getCloseStatus).toHaveBeenCalledWith(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "結單並隱藏入口校慶預購" }));
    expect(await screen.findByRole("status")).toHaveTextContent("商品已從公開目錄隱藏");
    expect(api.closeCategory).toHaveBeenCalledWith("a", {});
    expect(screen.getByText("班聯已結單，公開入口已隱藏")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新開放並顯示校慶預購" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("恢復公開顯示"));
    expect(api.reopenCategory).toHaveBeenCalledWith("a");
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("更新失敗保留原狀態並允許重試", async () => {
    render(<ClosureSettings />);
    await screen.findByText("尚未結單");
    api.closeCategory.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "結單並隱藏入口校慶預購" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("活動鎖單狀態更新失敗");
    expect(screen.getByText("尚未結單")).toBeVisible();
    const retry = screen.getByRole("button", { name: "結單並隱藏入口校慶預購" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(await screen.findByRole("status")).toHaveTextContent("商品已從公開目錄隱藏");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("班級結單不會被當成整個商品批次已鎖單", async () => {
    api.getCloseStatus.mockResolvedValueOnce({ statuses: { a: { is_closed: true, is_global: false } } });
    render(<ClosureSettings />);
    await screen.findByText("尚未結單");
    fireEvent.click(screen.getByRole("button", { name: "結單並隱藏入口校慶預購" }));
    await screen.findByRole("status");
    expect(api.closeCategory).toHaveBeenCalledWith("a", {});
    expect(api.reopenCategory).not.toHaveBeenCalled();
  });

  it("載入既有全域鎖單後能直接重新開放", async () => {
    api.getCloseStatus.mockResolvedValueOnce({ statuses: { a: { is_closed: true, is_global: true } } });
    render(<ClosureSettings />);
    await screen.findByText("班聯已結單，公開入口已隱藏");
    fireEvent.click(screen.getByRole("button", { name: "重新開放並顯示校慶預購" }));
    await screen.findByRole("status");
    expect(api.reopenCategory).toHaveBeenCalledWith("a");
    expect(api.closeCategory).not.toHaveBeenCalled();
  });

  it("更新中不接受重複操作或另一批次的操作", async () => {
    api.closeCategory.mockReturnValue(new Promise(() => {}));
    render(<ActivityOrderClosure categories={[...categories, { id: "b", name: "冬季預購" }]} onSaved={vi.fn()} />);
    const lock = screen.getByRole("button", { name: "結單並隱藏入口校慶預購" });
    await waitFor(() => expect(lock).toBeEnabled());
    fireEvent.click(lock);
    expect(lock).toBeDisabled();
    expect(screen.getByRole("button", { name: "結單並隱藏入口冬季預購" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "結單並隱藏入口冬季預購" }));
    expect(api.closeCategory).toHaveBeenCalledOnce();
  });

  it("狀態載入失敗時不提供鎖單操作，重新載入後恢復", async () => {
    api.getCloseStatus.mockRejectedValueOnce(new Error("offline"));
    render(<ClosureSettings />);
    expect(screen.getByRole("button", { name: "結單並隱藏入口校慶預購" })).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入鎖單狀態");
    expect(screen.queryByText("尚未結單")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新載入鎖單狀態" }));
    await screen.findByText("尚未結單");
    expect(screen.getByRole("button", { name: "結單並隱藏入口校慶預購" })).toBeEnabled();
  });

  it("不將缺少的狀態當成未鎖單", async () => {
    api.getCloseStatus.mockResolvedValueOnce({ statuses: {} });
    render(<ClosureSettings />);
    await screen.findByRole("alert");
    expect(screen.getByText("狀態待確認")).toBeVisible();
    expect(screen.getByRole("button", { name: "結單並隱藏入口校慶預購" })).toBeDisabled();
  });

  it("沒有商品批次時不顯示無用區塊或要求另外建立活動", () => {
    const { container } = render(<ActivityOrderClosure categories={[]} onSaved={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.getCloseStatus).not.toHaveBeenCalled();
  });
});
