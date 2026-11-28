import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgencyAdminPage from "./page";

const mocks = vi.hoisted(() => ({
  perms: new Set<string>(),
  manageable: vi.fn(),
  update: vi.fn(),
  adminUpdate: vi.fn(),
  entries: vi.fn(),
  createEntry: vi.fn(),
  orgs: vi.fn(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canAny: (...codes: string[]) => codes.some((code) => mocks.perms.has(code)),
    isReady: true,
  }),
}));
vi.mock("@/lib/api", () => ({
  agenciesApi: {
    manageable: mocks.manageable,
    update: mocks.update,
    adminUpdate: mocks.adminUpdate,
    entries: mocks.entries,
    createEntry: mocks.createEntry,
  },
  orgsApi: { list: mocks.orgs },
  apiErrorMessage: (_: unknown, fallback: string) => fallback,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const agency = {
  id: "a1", slug: "student-union", branch: "executive", name: "學生會", tagline: null, org_id: "o1",
  intro_md: "介紹", mandate_md: null, contact_md: null, is_published: true, sort_order: 0,
  updated_at: "2026-11-28T00:00:00Z", org_name: "學生會", can_admin: false,
};

beforeEach(() => {
  mocks.perms = new Set(["agency:manage"]);
  mocks.manageable.mockReset().mockResolvedValue([agency]);
  mocks.update.mockReset().mockResolvedValue(agency);
  mocks.adminUpdate.mockReset();
  mocks.entries.mockReset().mockResolvedValue([]);
  mocks.createEntry.mockReset().mockImplementation(async (_id: string, body: object) => ({
    ...body, id: "e1", agency_id: "a1", updated_at: "2026-11-28T00:00:00Z",
  }));
  mocks.orgs.mockReset().mockResolvedValue([]);
});

describe("機關專頁維護", () => {
  it("blocks users without agency or site permission before loading data", () => {
    mocks.perms = new Set();
    render(<AgencyAdminPage />);
    expect(screen.getByText("需要機關專頁維護權限")).toBeInTheDocument();
    expect(mocks.manageable).not.toHaveBeenCalled();
  });

  it("lets an org maintainer edit content without structural fields", async () => {
    render(<AgencyAdminPage />);
    const name = await screen.findByLabelText("名稱");
    expect(screen.queryByLabelText("網址代稱")).toBeNull();
    expect(screen.queryByRole("button", { name: /新增機關/ })).toBeNull();
    expect(mocks.orgs).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "學生會（第 30 屆）" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ name: "學生會（第 30 屆）", tagline: null });
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
  });

  it("creates an entry of the selected kind and flags calendar items without a date", async () => {
    render(<AgencyAdminPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /活動成果/ }));
    fireEvent.click(screen.getByRole("button", { name: "新增活動成果" }));

    const form = screen.getByRole("form", { name: "新增活動成果" });
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "校慶園遊會" } });
    fireEvent.click(screen.getByLabelText("顯示於首頁行事曆"));
    expect(screen.getByText("需要日期才會出現在行事曆")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-11-08" } });
    expect(screen.queryByText("需要日期才會出現在行事曆")).toBeNull();
    fireEvent.change(screen.getByLabelText("附件或 Google 雲端連結"), {
      target: { value: "https://docs.google.com/document/d/abc/edit" },
    });
    fireEvent.submit(form);

    await waitFor(() => expect(mocks.createEntry).toHaveBeenCalledOnce());
    expect(mocks.createEntry.mock.calls[0]).toEqual(["a1", expect.objectContaining({
      kind: "achievement",
      title: "校慶園遊會",
      occurred_on: "2026-11-08",
      show_on_calendar: true,
      is_published: false,
      link_url: "https://docs.google.com/document/d/abc/edit",
      summary: null,
    })]);
    expect(await screen.findByText("校慶園遊會")).toBeInTheDocument();
  });

  it("shows structural fields and org binding to site admins", async () => {
    mocks.perms = new Set(["site:manage"]);
    mocks.manageable.mockResolvedValue([{ ...agency, can_admin: true }]);
    mocks.orgs.mockResolvedValue([{ id: "o1", name: "學生會" }, { id: "o2", name: "學生議會" }]);
    render(<AgencyAdminPage />);
    expect(await screen.findByLabelText("網址代稱")).toHaveValue("student-union");
    expect(screen.getByRole("button", { name: /新增機關/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("option", { name: "學生議會" }).length).toBeGreaterThan(0));
  });
});
