import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { regulationSyncApi } from "@/lib/api/regulation-sync";
import { orgsApi } from "@/lib/api/orgs";
import type { OrgRead, RegulationSyncStatusOut } from "@/lib/types";
import RegulationSyncPanel from "./RegulationSyncPanel";

vi.mock("@/lib/api/orgs", () => ({ orgsApi: { list: vi.fn() } }));
vi.mock("@/lib/api/regulation-sync", () => ({ regulationSyncApi: { status: vi.fn(), configure: vi.fn(), run: vi.fn() } }));

const configured: RegulationSyncStatusOut = {
  configured: true, drive_ready: true,
  source: { id: "source", org_id: "org", folder_id: "abcdefghijk", frequency: "daily", next_sync_at: null, requested_at: null, last_synced_at: null, last_report: { items: [] } },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orgsApi.list).mockResolvedValue([{ id: "org", name: "班聯會", parent_id: null } as OrgRead]);
  vi.mocked(regulationSyncApi.status).mockResolvedValue(configured);
  vi.mocked(regulationSyncApi.configure).mockResolvedValue(configured);
  vi.mocked(regulationSyncApi.run).mockResolvedValue({ ...configured, source: { ...configured.source!, requested_at: "2026-11-13T01:00:00Z" } });
});

async function open() {
  render(<RegulationSyncPanel onSynced={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /法規來源同步/ }));
  await screen.findByRole("button", { name: "立即對照並同步" });
}

describe("法規來源同步", () => {
  it("requires saving changes before syncing and sends weekly frequency", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("自動更新頻率"), { target: { value: "weekly" } });
    expect(screen.getByRole("button", { name: "立即對照並同步" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));
    await waitFor(() => expect(regulationSyncApi.configure).toHaveBeenCalledWith("org", { folder_id: "abcdefghijk", frequency: "weekly" }));
    await screen.findByText("已儲存同步設定。");
    fireEvent.click(screen.getByRole("button", { name: "立即對照並同步" }));
    await screen.findByRole("button", { name: "同步中…" });
    expect(regulationSyncApi.run).toHaveBeenCalledWith("org");
  });

  it("explains missing connection and disables synchronization", async () => {
    vi.mocked(regulationSyncApi.status).mockResolvedValue({ ...configured, drive_ready: false });
    await open();
    expect(screen.getByText(/尚未連接 Drive/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即對照並同步" })).toBeDisabled();
  });

  it("shows configuration errors without allowing an unconfigured run", async () => {
    vi.mocked(regulationSyncApi.status).mockRejectedValue(new Error("offline"));
    render(<RegulationSyncPanel onSynced={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /法規來源同步/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入同步設定");
    expect(screen.queryByRole("button", { name: "立即對照並同步" })).not.toBeInTheDocument();
  });
});
