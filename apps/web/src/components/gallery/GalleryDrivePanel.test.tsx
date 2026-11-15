import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { gallerySyncApi } from "@/lib/api/gallery-sync";
import type { GalleryDriveStatusOut } from "@/lib/types";
import GalleryDrivePanel from "./GalleryDrivePanel";

vi.mock("@/lib/api/gallery-sync", () => ({ gallerySyncApi: { status: vi.fn(), configure: vi.fn(), run: vi.fn() } }));
const status: GalleryDriveStatusOut = { config: { sources: [], photographers: [], frequency: "manual" }, drive_ready: true, last_report: { errors: [], created: 0, updated: 0, unchanged: 0, unattributed: 0 } };
const albums = [{ id: "welcome", title: "迎新", summary: "", sourceUrl: "", layout: "spread" as const, photos: [] }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(gallerySyncApi.status).mockResolvedValue(status);
  vi.mocked(gallerySyncApi.configure).mockImplementation(async (config) => ({ ...status, config }));
  vi.mocked(gallerySyncApi.run).mockResolvedValue({ ...status, requested_at: "2026-11-15T00:00:00Z" });
});

async function open(disabled = false) {
  render(<GalleryDrivePanel albums={albums} disabled={disabled} onSynced={vi.fn()} />);
  fireEvent.click(screen.getByText("Google Drive 同步"));
  await screen.findByText("照片來源");
}

it("saves multiple folders with photographer mapping and requires saving before sync", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  fireEvent.change(screen.getByLabelText("資料夾網址或 ID 1"), { target: { value: "parentfolder1" } });
  fireEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  fireEvent.change(screen.getByLabelText("資料夾網址或 ID 2"), { target: { value: "childfolder12" } });
  fireEvent.change(screen.getByLabelText("活動環節 2"), { target: { value: "開場" } });
  fireEvent.click(screen.getByRole("button", { name: "新增攝影師對應" }));
  fireEvent.change(screen.getByLabelText("電子郵件 1"), { target: { value: "photo@example.com" } });
  fireEvent.change(screen.getByLabelText("攝影師姓名 1"), { target: { value: "攝影甲" } });
  expect(screen.getByRole("button", { name: "立即同步照片" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "儲存 Drive 設定" }));
  await waitFor(() => expect(gallerySyncApi.configure).toHaveBeenCalledWith(expect.objectContaining({
    sources: [expect.objectContaining({ folder_id: "parentfolder1" }), expect.objectContaining({ folder_id: "childfolder12", section: "開場" })],
    photographers: [{ email: "photo@example.com", name: "攝影甲" }],
  })));
  await screen.findByText("已儲存 Drive 設定");
  fireEvent.click(screen.getByRole("button", { name: "立即同步照片" }));
  await screen.findByText("照片同步中…");
});

it("blocks settings until album edits are published", async () => {
  await open(true);
  expect(screen.getByText("請先發布活動變更，再管理 Drive 來源。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新增資料夾" })).toBeDisabled();
});

it("retains edits when saving fails", async () => {
  vi.mocked(gallerySyncApi.configure).mockRejectedValue(new Error("offline"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: "新增攝影師對應" }));
  fireEvent.change(screen.getByLabelText("攝影師姓名 1"), { target: { value: "攝影甲" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存 Drive 設定" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("攝影師姓名 1")).toHaveValue("攝影甲");
});
