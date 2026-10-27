import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDirectoryPanel } from "./AccountDirectoryPanel";
import { adminApi } from "@/lib/api";
import type { AdminUserDetail } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  adminApi: { getUser: vi.fn(), listUsers: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("./AccountDetailPanel", () => ({
  AccountDetailPanel: ({ user }: { user: AdminUserDetail }) => <h2>{user.display_name}的帳號詳情</h2>,
}));

const listed: AdminUserDetail = {
  id: "listed", display_name: "名單內同學", email: "listed@example.test",
  student_id: "115001", linked_emails: [], class_roster: [], positions: [], is_active: true,
  avatar_url: null, is_verified: true, show_email: false, ui_theme: "auto", ui_locale: "zh-TW",
  notification_preferences: {}, notification_digest_frequency: "off", muted_notification_modules: [],
  mfa_enabled: false, is_superuser: false, is_owner: false, created_at: "2026-10-27T00:00:00Z",
  effective_permissions: [],
};
const linked = { ...listed, id: "linked", display_name: "連結同學" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.getUser).mockImplementation(async (id) => id === linked.id ? linked : listed);
  vi.mocked(adminApi.listUsers).mockResolvedValue([]);
});

describe("帳號清單與人員連結入口", () => {
  it("開啟人員連結的帳號，即使不在初始 200 筆名單中", async () => {
    render(<AccountDirectoryPanel users={[listed]} loading={false} classes={[]}
      canManageClasses onRefresh={vi.fn()} initialSelectedId={linked.id} />);

    expect(await screen.findByRole("heading", { name: "連結同學的帳號詳情" })).toBeInTheDocument();
    expect(adminApi.getUser).toHaveBeenCalledWith(linked.id);
    expect(adminApi.getUser).not.toHaveBeenCalledWith(listed.id);

    fireEvent.click(screen.getByRole("button", { name: "返回帳號清單" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "搜尋平台帳號" })).toHaveFocus());
  });

  it("開啟另一筆帳號失敗時顯示錯誤，不沿用前一人的詳細資料", async () => {
    vi.mocked(adminApi.getUser).mockImplementation(async (id) => {
      if (id === linked.id) throw new Error("offline");
      return listed;
    });
    render(<AccountDirectoryPanel users={[listed, linked]} loading={false} classes={[]}
      canManageClasses onRefresh={vi.fn()} />);
    await screen.findByRole("heading", { name: "名單內同學的帳號詳情" });
    fireEvent.click(screen.getByRole("button", { name: /連結同學/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入帳號詳情");
    expect(screen.queryByRole("heading", { name: "名單內同學的帳號詳情" })).not.toBeInTheDocument();
  });

  it("遠端搜尋無結果時清除原本的帳號詳情", async () => {
    render(<AccountDirectoryPanel users={[listed]} loading={false} classes={[]}
      canManageClasses onRefresh={vi.fn()} />);
    await screen.findByRole("heading", { name: "名單內同學的帳號詳情" });
    fireEvent.change(screen.getByRole("textbox", { name: "搜尋平台帳號" }), { target: { value: "查無資料" } });
    expect(await screen.findByText("找不到符合條件的帳號。")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "名單內同學的帳號詳情" })).not.toBeInTheDocument());
  });
});
