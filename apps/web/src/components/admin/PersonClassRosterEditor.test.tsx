import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PersonClassRosterEditor from "./PersonClassRosterEditor";
import type { PersonDetailOut, SchoolClassListItem } from "@/lib/types";

const api = vi.hoisted(() => ({ roster: vi.fn(), addRoster: vi.fn(), updateRoster: vi.fn() }));
vi.mock("@/lib/api", () => ({ classApi: api, ApiError: class extends Error {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const schoolClass = { id: "class", academic_year: 115, class_code: "101", grade: 1, is_active: true } as SchoolClassListItem;
const person: PersonDetailOut = {
  id: "person", display_name: "測試同學", student_id: "510007", user_id: null,
  email: null, legal_name: null, note: null, status: "active", created_at: "", updated_at: "",
  affiliations: [],
  class_roster: [{ class_id: "class", academic_year: 115, class_code: "101", is_active: true, student_id: "510007", seat_number: 7 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  api.roster.mockResolvedValue([{ id: "entry", student_id: "510007" }]);
  api.updateRoster.mockResolvedValue({});
  api.addRoster.mockResolvedValue({});
});

describe("人員編輯頁座號設定", () => {
  it("updates an unregistered student's existing roster and refreshes details", async () => {
    const changed = vi.fn().mockResolvedValue(undefined);
    render(<PersonClassRosterEditor person={person} classes={[schoolClass]} onChanged={changed} />);
    expect(screen.getByRole("spinbutton", { name: "設定座號" })).toHaveValue(7);
    fireEvent.change(screen.getByRole("spinbutton", { name: "設定座號" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存座號" }));
    await waitFor(() => expect(api.updateRoster).toHaveBeenCalledWith("class", "entry", { seat_number: 12 }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });

  it("creates a roster entry for a person already assigned to the class", async () => {
    api.roster.mockResolvedValue([]);
    render(<PersonClassRosterEditor person={person} classes={[schoolClass]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "儲存座號" }));
    await waitFor(() => expect(api.addRoster).toHaveBeenCalledWith("class", { seat_number: 7, student_id: "510007" }));
  });

  it("preserves input and exposes a retry after a failure", async () => {
    api.updateRoster.mockRejectedValue(new Error("offline"));
    const changed = vi.fn();
    render(<PersonClassRosterEditor person={person} classes={[schoolClass]} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "儲存座號" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("儲存座號失敗");
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton", { name: "設定座號" })).toHaveValue(7);
    expect(screen.getByRole("button", { name: "儲存座號" })).toBeEnabled();
  });

  it("requires a saved student ID", () => {
    render(<PersonClassRosterEditor person={{ ...person, student_id: null }} classes={[schoolClass]} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "儲存座號" })).toBeDisabled();
    expect(screen.getByText("請先儲存學號，再設定座號。")).toBeInTheDocument();
  });
});
