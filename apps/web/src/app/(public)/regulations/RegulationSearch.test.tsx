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

describe("法規主頁整合管理操作", () => {
  it("管理者直接在同一列表新增、查看待審案件與篩選草稿", async () => {
    state.permissions = ["regulation:create", "regulation:schedule"];
    const view = render(<RegulationSearch />);
    await screen.findByRole("link", { name: "測試自治條例" });
    expect(screen.getByRole("link", { name: "新增法規" })).toHaveAttribute("href", "/regulations/new");
    expect(screen.getByRole("link", { name: "待審案件" })).toHaveAttribute("href", "/regulations/pending");
    expect(screen.queryByRole("button", { name: "法規管理" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "法規狀態" }), { target: { value: "draft" } });
    expect(state.replace).toHaveBeenCalledWith("/regulations?workflow=draft", { scroll: false });
    state.params = new URLSearchParams("workflow=draft");
    state.list.mockResolvedValueOnce([{ ...regulation, is_active: false, workflow_status: "draft" }]);
    view.rerender(<RegulationSearch />);
    await waitFor(() => expect(state.list).toHaveBeenLastCalledWith({ active_only: "false", workflow_status: "draft" }));
    await screen.findByRole("cell", { name: "草稿" });
    expect(screen.getByRole("heading", { name: "法規查詢" })).toBeInTheDocument();
  });

  it("公開訪客的網址參數不會開啟草稿或管理工具", async () => {
    state.params = new URLSearchParams("workflow=draft");
    render(<RegulationSearch />);
    await waitFor(() => expect(state.list).toHaveBeenCalledWith({ active_only: "true", workflow_status: "published" }));
    expect(screen.queryByRole("link", { name: "新增法規" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "草稿" })).not.toBeInTheDocument();
    expect(screen.queryByText("資料同步")).not.toBeInTheDocument();
  });

  it("管理者可在原查詢表格列出全部狀態，保留分類與搜尋條件", async () => {
    state.permissions = ["regulation:create"];
    state.params = new URLSearchParams("workflow=all&category=ordinance&keyword=自治");
    render(<RegulationSearch />);
    await waitFor(() => expect(state.list).toHaveBeenCalledWith("自治", { active_only: "false", category: "ordinance" }));
    expect(screen.getByRole("searchbox")).toHaveValue("自治");
  });
});
