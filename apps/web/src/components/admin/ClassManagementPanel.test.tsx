import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassesAdminPage from "@/app/(admin)/admin/classes/page";

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), members: vi.fn(), memberships: vi.fn(), roster: vi.fn(), roles: vi.fn(), assignRole: vi.fn(), assignPersonRole: vi.fn(), listForSearch: vi.fn() }));
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
  api.roles.mockResolvedValue([{ role_key: "class_leader", label: "班長", holders: [], person_holders: [], permission_codes: [] }]);
  api.assignRole.mockResolvedValue({ user_position_id: "position" });
  api.assignPersonRole.mockResolvedValue({ person_affiliation_id: "affiliation", person_id: "person", status: "pending_user" });
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
    fireEvent.click(await screen.findByRole("button", { name: "設定班代（議員）與幹部" }));
    expect(screen.getByRole("option", { name: "7 號 · 測試同學 · 510007" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "選擇班長" }), { target: { value: student.id } });
    fireEvent.click(screen.getByRole("button", { name: "任命班長" }));
    await waitFor(() => expect(api.assignRole).toHaveBeenCalledWith("class", "class_leader", { user_id: student.id }));
    expect(api.listForSearch).not.toHaveBeenCalled();
  });

  it("opens linked member details and appoints without leaving the member tab", async () => {
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "檢視7 號 測試同學的資料與職位" }));

    expect(await screen.findByRole("dialog", { name: "測試同學" })).toBeVisible();
    expect(screen.getByText("student@example.test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "任命班長" }));

    await waitFor(() => expect(api.assignRole).toHaveBeenCalledWith("class", "class_leader", { user_id: student.id }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "測試同學" })).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "搜尋班級成員" })).toBeInTheDocument();
  });

  it("lets an unregistered person record a pending appointment from their details", async () => {
    api.members.mockResolvedValue([
      { ...student, user_id: student.id, seat_number: 7, source: "roster" },
      { id: "person-unlinked", display_name: "待註冊同學", student_id: "510008", email: "", user_id: null, source: "person_affiliation" },
    ]);
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "檢視8 號 待註冊同學的資料與職位" }));

    expect(await screen.findByRole("dialog", { name: "待註冊同學" })).toBeVisible();
    expect(screen.getByText("可以先登記任命；職位權限會在同學註冊並連結帳號後生效。"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "登記任命班長" }));

    await waitFor(() => expect(api.assignPersonRole).toHaveBeenCalledWith(
      "class",
      "class_leader",
      { person_id: "person-unlinked" },
    ));
    expect(api.assignRole).not.toHaveBeenCalled();
  });

  it("creates a person record when an unregistered roster entry has no profile yet", async () => {
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "檢視8 號 尚未連結帳號的資料與職位" }));
    await screen.findByRole("dialog", { name: "尚未連結帳號" });
    const nameInput = screen.getByRole("textbox", { name: "成員姓名（建立人員資料）" });
    const appointButton = screen.getByRole("button", { name: "登記任命班長" });
    expect(appointButton).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: "待註冊名冊同學" } });
    fireEvent.click(appointButton);

    await waitFor(() => expect(api.assignPersonRole).toHaveBeenCalledWith(
      "class",
      "class_leader",
      { student_id: "510008", display_name: "待註冊名冊同學" },
    ));
  });

  it("shows pending appointments for unregistered roster students and prevents duplicate appointment", async () => {
    api.roles.mockResolvedValue([{
      role_key: "class_leader",
      label: "班長",
      holders: [],
      person_holders: [{
        affiliation_id: "affiliation",
        person_id: "person-unlinked",
        display_name: "待註冊同學",
        email: "",
        student_id: "510008",
        status: "pending_user",
      }],
    }]);
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "檢視8 號 待註冊同學的資料與職位" }));

    expect(await screen.findByRole("dialog", { name: "待註冊同學" })).toBeVisible();
    expect(screen.getByRole("button", { name: "已任命" })).toBeDisabled();
    expect(api.assignPersonRole).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: "設定班代（議員）與幹部" }));
    expect(screen.getByRole("option", { name: "測試同學 · 510007" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /尚未登入的同學/ })).not.toBeInTheDocument();
  });

  it("shows a retry action when the class data cannot load", async () => {
    api.get.mockRejectedValueOnce(new Error("offline"));
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "重新載入班級" }));
    expect(await screen.findByRole("textbox", { name: "搜尋班級成員" })).toBeInTheDocument();
  });

  it("recovers from a failed class list without presenting it as an empty school", async () => {
    api.list.mockRejectedValueOnce(new Error("offline"));
    render(<ClassesAdminPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入班級清單");
    expect(screen.queryByText("0 個班級")).not.toBeInTheDocument();
    expect(screen.queryByText("請先建立或選擇班級。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新載入班級清單" }));
    expect(await screen.findByRole("textbox", { name: "搜尋班級成員" })).toBeInTheDocument();
  });

  it("identifies the representative as a council member while retaining the correct role key", async () => {
    api.roles.mockResolvedValue([{ role_key: "class_representative", label: "班代", holders: [], person_holders: [] }]);
    render(<ClassesAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "設定班代（議員）與幹部" }));
    expect(screen.getByRole("heading", { name: "班代（議員）" })).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "選擇班代（議員）" }), { target: { value: student.id } });
    fireEvent.click(screen.getByRole("button", { name: "任命班代（議員）" }));
    await waitFor(() => expect(api.assignRole).toHaveBeenCalledWith("class", "class_representative", { user_id: student.id }));
  });
});
