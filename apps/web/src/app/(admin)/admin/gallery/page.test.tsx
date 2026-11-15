import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GalleryAdminPage from "./page";
import { gallerySettingsValue, readActivityAlbums } from "@/lib/public-activity-albums";

const mocks = vi.hoisted(() => ({
  allowed: true,
  adminSettings: vi.fn(),
  updateSettings: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => mocks.allowed, isReady: true }) }));
vi.mock("@/lib/api", () => ({ siteApi: { adminSettings: mocks.adminSettings, updateSettings: mocks.updateSettings } }));
vi.mock("@/lib/gallery-upload", () => ({ uploadGalleryPhoto: mocks.upload }));

beforeEach(() => {
  mocks.allowed = true;
  mocks.adminSettings.mockReset().mockResolvedValue({ homepage_blocks: { unrelated: { keep: true } } });
  mocks.updateSettings.mockReset().mockResolvedValue({});
  mocks.upload.mockReset();
});

describe("活動影像管理", () => {
  it("does not fetch or expose the editor without site management permission", () => {
    mocks.allowed = false;
    render(<GalleryAdminPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("沒有管理公開網站");
    expect(mocks.adminSettings).not.toHaveBeenCalled();
  });

  it("applies a photographer to selected photos, stores one activity date and preserves other homepage settings", async () => {
    render(<GalleryAdminPage />);
    await screen.findByLabelText("活動名稱");
    fireEvent.change(screen.getByLabelText("活動日期"), { target: { value: "2026-11-14" } });
    fireEvent.change(screen.getAllByLabelText("攝影師")[0], { target: { value: "活動攝影 A" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "選取照片 1" }));
    fireEvent.click(screen.getByRole("button", { name: "套用到選取的 1 張" }));
    fireEvent.click(screen.getByRole("button", { name: "發布變更" }));
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledOnce());
    const body = mocks.updateSettings.mock.calls[0][0];
    expect(body.homepage_blocks.unrelated).toEqual({ keep: true });
    expect(body.homepage_blocks.activity_gallery.events[0].date).toBe("2026-11-14");
    expect(body.homepage_blocks.activity_gallery.events[0].photos[0].photographer).toBe("活動攝影 A");
    expect(body.homepage_blocks.activity_gallery.events[0].photos[1].photographer).toBeUndefined();
    expect(body.homepage_blocks.activity_gallery.events[0].photos[0]).not.toHaveProperty("date");
  });

  it("retains successful uploads and retries only failed files", async () => {
    const photo = readActivityAlbums({})[0].photos[0];
    mocks.upload.mockResolvedValueOnce({ ...photo, id: "new-1" }).mockRejectedValueOnce(new Error("網路中斷")).mockResolvedValueOnce({ ...photo, id: "new-2" });
    render(<GalleryAdminPage />);
    const input = await screen.findByLabelText("批次上傳活動照片");
    fireEvent.change(input, { target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })] } });
    await screen.findByRole("button", { name: "重試失敗的 1 張" });
    fireEvent.click(screen.getByRole("button", { name: "重試失敗的 1 張" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("button", { name: "發布變更" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "發布變更" }));
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledOnce());
    const photos = mocks.updateSettings.mock.calls[0][0].homepage_blocks.activity_gallery.events[0].photos;
    expect(photos).toHaveLength(5);
    expect(new Set(photos.map((item: { id: string }) => item.id)).size).toBe(5);
  });

  it("blocks publishing over another editor's newer gallery", async () => {
    mocks.adminSettings.mockResolvedValueOnce({ homepage_blocks: {} })
      .mockResolvedValue({ homepage_blocks: { activity_gallery: gallerySettingsValue([]) } });
    render(<GalleryAdminPage />);
    fireEvent.change(await screen.findByLabelText("活動名稱"), { target: { value: "新的迎新名稱" } });
    fireEvent.click(screen.getByRole("button", { name: "發布變更" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("已被其他人更新"));
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
