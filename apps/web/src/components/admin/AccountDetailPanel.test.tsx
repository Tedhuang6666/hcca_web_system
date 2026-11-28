import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountDetailPanel } from "./AccountDetailPanel";
import type { AdminUserDetail } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  adminApi: {},
  classApi: { roster: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("./AccountGovernanceSections", () => ({
  AccountLifecycleSection: () => <p>學籍</p>,
  AccountTenureSection: () => <p>幹部任期</p>,
}));
vi.mock("./AccountMergeSection", () => ({ AccountMergeSection: () => null }));

const user: AdminUserDetail = {
  id: "u1", display_name: "連結同學", email: "u1@example.test",
  student_id: "115001", linked_emails: [], class_roster: [], positions: [], is_active: true,
  avatar_url: null, is_verified: true, show_email: false, ui_theme: "auto", ui_locale: "zh-TW",
  notification_preferences: {}, notification_digest_frequency: "off", muted_notification_modules: [],
  mfa_enabled: false, is_superuser: false, is_owner: false, created_at: "2026-10-27T00:00:00Z",
  effective_permissions: [],
};

describe("AccountDetailPanel", () => {
  it("嵌在人員詳情時不重複顯示班級與座號，但保留任期與安全設定", () => {
    render(<AccountDetailPanel embedded user={user} users={[]} classes={[]} canManageClasses onChanged={vi.fn()} />);

    expect(screen.queryByText("班級與座號")).not.toBeInTheDocument();
    expect(screen.getByText("學籍與幹部任期")).toBeInTheDocument();
    expect(screen.getByText("安全維護")).toBeInTheDocument();
  });

  it("獨立帳號面板仍顯示班級與座號", () => {
    render(<AccountDetailPanel user={user} users={[]} classes={[]} canManageClasses onChanged={vi.fn()} />);

    expect(screen.getByText("班級與座號")).toBeInTheDocument();
  });
});
