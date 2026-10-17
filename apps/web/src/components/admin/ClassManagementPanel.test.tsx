import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassesAdminPage from "@/app/(admin)/admin/classes/page";

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), members: vi.fn(), memberships: vi.fn(), roster: vi.fn(), roles: vi.fn(), assignRole: vi.fn(), listForSearch: vi.fn() }));
vi.mock("@/lib/api", () => ({ classApi: api, usersApi: api, ApiError: class extends Error {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/components/admin/PeopleManagementEmbedContext", () => ({ usePeopleManagementEmbed: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const student = { id: "student", display_name: "測試同學", student_id: "510007", email: "student@example.test" };
const schoolClass = { id: "class", academic_year: 115, class_code: "101", grade: 1, is_active: true, ranges: [] };

beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue([schoolClass]);
  api.get.mockResolvedValue(schoolClass);
  api.members.mockResolvedValue([{ ...student, user_id: student.id, seat_number: 7, source: "roster" }]);
  api.memberships.mockResolvedValue([]);
  api.roster.mockResolvedValue([
    { id: "linked", seat_number: 7, student_id: "510007", user_id: student.id, user: student },
    { id: "unlinked", seat_number: 8, student_id: "510008", user_id: null, user: null },
  ]);
  api.roles.mockResolvedValue([{ role_key: "class_leader", label: "班長", holders: [], permission_codes: [] }]);
  api.assignRole.mockResolvedValue({ user_position_id: "position" });
});

describe("班級管理工作台", () => {
  it("opens the complete member list and lets staff find unlinked students", async () => {
    render(<ClassesAdminPage />);
    expect(await screen.findByRole("textbox", { name: "搜尋班級成員" })).toBeInTheDocument();
    expect(screen.getByText("測試同學")).toBeInTheDocument();
    expect(screen.getByText("共 2 位 · 1 位待連結帳號")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "只看待連結" }));
    expect(screen.queryByText("測試同學")).not.toBeInTheDocument();
    expect(screen.getByText("尚未連結帳號")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜尋班級成員" }), { target: { value: "510099" } });
    expect(screen.getByText("沒有符合的成員，請調整搜尋條件。")).toBeInTheDocument();
  });

  it("appoints a local student by seat without searching accounts again", async () => {
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "設定班級幹部" }));
    expect(screen.getByRole("option", { name: "7 號 · 測試同學 · 510007" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "選擇班長" }), { target: { value: student.id } });
    fireEvent.click(screen.getByRole("button", { name: "任命班長" }));
    await waitFor(() => expect(api.assignRole).toHaveBeenCalledWith("class", "class_leader", { user_id: student.id }));
    expect(api.listForSearch).not.toHaveBeenCalled();
  });

  it("recognizes linked people without membership snapshots and excludes unlinked people from appointments", async () => {
    api.roster.mockResolvedValue([]);
    api.members.mockResolvedValue([
      { ...student, user_id: student.id, source: "person_affiliation" },
      { id: "unlinked-person", display_name: "尚未登入的同學", user_id: null, student_id: "510008", email: "", source: "person_affiliation" },
    ]);
    render(<ClassesAdminPage />);
    await screen.findByRole("textbox", { name: "搜尋班級成員" });
    expect(screen.getByText("共 2 位 · 1 位待連結帳號")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "只看待連結" }));
    expect(screen.queryByText("測試同學")).not.toBeInTheDocument();
    expect(screen.getByText("尚未登入的同學")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "設定班級幹部" }));
    expect(screen.getByRole("option", { name: "測試同學 · 510007" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /尚未登入的同學/ })).not.toBeInTheDocument();
  });

  it("shows a retry action when the class data cannot load", async () => {
    api.get.mockRejectedValueOnce(new Error("offline"));
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "重新載入班級" }));
    expect(await screen.findByRole("textbox", { name: "搜尋班級成員" })).toBeInTheDocument();
  });
});
