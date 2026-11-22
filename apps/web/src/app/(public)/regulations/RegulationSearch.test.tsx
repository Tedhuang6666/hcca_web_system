import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegulationListItem } from "@/lib/types";
import RegulationSearch from "./RegulationSearch";

const state = vi.hoisted(() => ({
  params: new URLSearchParams(), permissions: [] as string[], replace: vi.fn(), list: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params, useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({
  can: (code: string) => state.permissions.includes(code),
  canAny: (...codes: string[]) => codes.some((code) => state.permissions.includes(code)),
}) }));
vi.mock("@/lib/api/regulations", () => ({
  regulationsApi: { list: state.list, search: state.list },
  regulationHref: (regulation: RegulationListItem) => `/regulations/${regulation.id}`,
}));
vi.mock("@/components/regulations/RegulationSyncPanel", () => ({ default: () => <div>資料同步面板</div> }));

const regulation: RegulationListItem = {
  id: "regulation-1", title: "測試自治條例", category: "ordinance", version: 1,
  is_active: true, is_repealed: false, workflow_status: "published", org_id: "org-1",
  published_at: "2026-11-08T00:00:00Z", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-08T00:00:00Z",
};

beforeEach(() => {
  state.params = new URLSearchParams(); state.permissions = []; state.replace.mockReset();
  state.list.mockReset().mockResolvedValue([regulation]);
});

describe("雲端法規查詢", () => {
  it("管理者在主頁管理同步與待公布資料，不提供起草或審議入口", async () => {
    state.permissions = ["regulation:admin"];
    const view = render(<RegulationSearch />);
    await screen.findByRole("link", { name: "測試自治條例" });
    expect(screen.queryByRole("link", { name: "新增法規" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "待審案件" })).not.toBeInTheDocument();
    expect(screen.getByText("資料同步")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "草稿" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "法規狀態" }), { target: { value: "unpublished" } });
    expect(state.replace).toHaveBeenCalledWith("/regulations?status=unpublished", { scroll: false });
    state.params = new URLSearchParams("status=unpublished");
    state.list.mockResolvedValueOnce([
      regulation,
      { ...regulation, id: "pending-1", title: "待公布自治條例", published_at: null, workflow_status: "draft" },
    ]);
    view.rerender(<RegulationSearch />);
    await screen.findByRole("link", { name: "待公布自治條例" });
    expect(screen.queryByRole("link", { name: "測試自治條例" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "待公布" })).toBeInTheDocument();
  });

  it("訪客的舊流程參數與待公布參數不會開啟內部資料或管理工具", async () => {
    state.params = new URLSearchParams("workflow=draft&status=unpublished");
    render(<RegulationSearch />);
    await waitFor(() => expect(state.list).toHaveBeenCalledWith({ active_only: "true", workflow_status: "published" }));
    expect(screen.queryByRole("option", { name: "待公布" })).not.toBeInTheDocument();
    expect(screen.queryByText("資料同步")).not.toBeInTheDocument();
  });

  it("保留分類與搜尋條件，且舊審議參數不再啟用流程", async () => {
    state.permissions = ["regulation:admin"];
    state.params = new URLSearchParams("workflow=all&category=ordinance&keyword=自治");
    render(<RegulationSearch />);
    await waitFor(() => expect(state.list).toHaveBeenCalledWith("自治", {
      active_only: "true", workflow_status: "published", category: "ordinance",
    }));
    expect(screen.getByRole("searchbox")).toHaveValue("自治");
  });
});
