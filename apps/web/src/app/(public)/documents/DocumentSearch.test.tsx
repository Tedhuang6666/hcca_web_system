import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentListItem } from "@/lib/types";
import DocumentSearch from "./DocumentSearch";

const state = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), list: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params, useRouter: () => ({ replace: state.replace }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAny: () => false }) }));
vi.mock("@/lib/api/documents", () => ({ documentsApi: { list: state.list } }));

function document(index: number): DocumentListItem {
  return {
    id: `doc-${index}`, serial_number: `測試字第${index}號`, title: `原始主旨${index}`,
    summary: `公示摘要${index}`, category: "decree", urgency: "normal", classification: "normal",
    status: "approved", org_id: "org-1", created_by: "user-1", subject: "原始主旨",
    issued_at: "2026-11-08T18:00:00Z", due_date: null, submitted_at: null, completed_at: null,
    created_at: "2026-11-01T00:00:00Z", is_redacted: false,
  };
}

beforeEach(() => { state.params = new URLSearchParams(); state.list.mockReset(); state.replace.mockReset(); });

describe("公開公文檢索", () => {
  it("新查詢失敗不將前次結果和筆數冒充為新查詢結果", async () => {
    state.list.mockResolvedValueOnce([document(1)]);
    const view = render(<DocumentSearch />);
    await screen.findByRole("link", { name: "公示摘要1" });
    state.params = new URLSearchParams("keyword=新查詢");
    state.list.mockRejectedValueOnce(new Error("offline"));
    view.rerender(<DocumentSearch />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "公示摘要1" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已載入公文 0 筆");
    state.list.mockResolvedValueOnce([document(2)]);
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    await screen.findByRole("link", { name: "公示摘要2" });
  });

  it("載入後續公文失敗仍保留本次查詢已讀取的結果", async () => {
    state.list.mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => document(index)));
    render(<DocumentSearch />);
    await screen.findByRole("link", { name: "公示摘要0" });
    state.list.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "載入更多公文" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "公示摘要0" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已載入公文 20 筆");
  });

  it("使用公開可見度與實際發文日期篩選，保留主旨摘要而非內部狀態", async () => {
    state.params = new URLSearchParams("issued_from=2026-11-01&issued_to=2026-11-09&category=decree");
    state.list.mockResolvedValueOnce([document(1)]);
    render(<DocumentSearch />);
    await waitFor(() => expect(state.list).toHaveBeenCalledWith(expect.objectContaining({
      visibility: "publicly_open", issued_from: "2026-11-01", issued_to: "2026-11-09", category: "decree",
    })));
    await screen.findByRole("link", { name: "公示摘要1" });
    expect(screen.getByText("115.11.09")).toBeInTheDocument();
    expect(screen.queryByText("已核准")).not.toBeInTheDocument();
    expect(screen.queryByText("限辦日期")).not.toBeInTheDocument();
  });
});
