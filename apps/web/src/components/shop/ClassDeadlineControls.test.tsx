import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassDeadlineControls from "./ClassDeadlineControls";
import type { CatalogCategoryOut, CloseStatusItem } from "@/lib/types";

const api = vi.hoisted(() => ({ closeCategory: vi.fn(), reopenCategory: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

const category: CatalogCategoryOut = {
  id: "category", name: "商品", activity_id: "activity", activity_name: "園遊會",
  order_closes_at: "2030-10-30T12:00:00Z", products: [], series: [], sort_order: 0,
};

function setup(statuses: Record<string, CloseStatusItem> = {}, categories = [category]) {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<ClassDeadlineControls label="園遊會" classId="class" categories={categories}
    statuses={statuses} onSaved={onSaved} />);
  return onSaved;
}

beforeEach(() => { vi.clearAllMocks(); api.closeCategory.mockResolvedValue({}); api.reopenCategory.mockResolvedValue({}); });

describe("班級截止設定", () => {
  it("以台北時間設定各分類相同的班級截止時間，並顯示活動上限", async () => {
    const saved = setup({}, [category, { ...category, id: "second" }]);
    const input = screen.getByLabelText("園遊會班級截止時間（台北時間）");
    expect(input).toHaveAttribute("max", "2030-10-30T20:00");
    fireEvent.change(input, { target: { value: "2030-10-29T18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存班級截止時間" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.closeCategory).toHaveBeenCalledWith("category", { class_id: "class", closes_at: "2030-10-29T10:00:00.000Z" });
    expect(api.closeCategory).toHaveBeenCalledWith("second", { class_id: "class", closes_at: "2030-10-29T10:00:00.000Z" });
    expect(screen.getByRole("status")).toHaveTextContent("到時仍可由班代代訂");
  });

  it("尚未到預約時間可以立即截止或取消預約", async () => {
    setup({ category: { is_closed: false, closes_at: "2030-10-29T10:00:00Z" } });
    expect(screen.getByText(/本班預計於 2030-10-29 18:00 截止/)).toBeInTheDocument();
    expect(screen.getByLabelText("園遊會班級截止時間（台北時間）")).toHaveValue("2030-10-29T18:00");
    fireEvent.click(screen.getByRole("button", { name: "立即截止本班" }));
    await waitFor(() => expect(api.closeCategory).toHaveBeenCalledWith("category", { class_id: "class", closes_at: null }));
    fireEvent.click(screen.getByRole("button", { name: "取消預約截止" }));
    await waitFor(() => expect(api.reopenCategory).toHaveBeenCalledWith("category", "class"));
  });

  it("班級截止明示班代仍可代訂，也能重新開放", async () => {
    setup({ category: { is_closed: true } });
    expect(screen.getByText("本班已截止，班代仍可代訂。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新開放本班" }));
    await waitFor(() => expect(api.reopenCategory).toHaveBeenCalledWith("category", "class"));
  });

  it.each(["activity", "category"])("%s 全域停止時禁止班代重新開放", (scope) => {
    setup(scope === "category" ? { category: { is_closed: true, is_global: true } } : {},
      [{ ...category, order_closed_at: scope === "activity" ? "2030-10-27T12:00:00Z" : null }]);
    expect(screen.getByText("班聯會已全域停止，班代亦無法代訂。")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("部分儲存失敗後重查目前狀態，保留輸入供重試", async () => {
    api.closeCategory.mockRejectedValueOnce(new Error("failed"));
    const saved = setup();
    fireEvent.change(screen.getByLabelText("園遊會班級截止時間（台北時間）"), { target: { value: "2030-10-29T18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存班級截止時間" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent("請確認目前狀態後重試");
    expect(screen.getByLabelText("園遊會班級截止時間（台北時間）")).toHaveValue("2030-10-29T18:00");
  });
});
