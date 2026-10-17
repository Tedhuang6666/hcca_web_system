import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-helpers";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace }, myConfirmation: vi.fn(), confirmClass: vi.fn(), refresh: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/api", async () => {
  const helpers = await import("@/lib/api-helpers");
  return {
    ApiError: helpers.ApiError, apiErrorMessage: helpers.apiErrorMessage,
    classApi: { myConfirmation: mocks.myConfirmation, confirmClass: mocks.confirmClass },
    authApi: { refresh: mocks.refresh },
  };
});
vi.mock("@/lib/auth-cache", () => ({ cacheCurrentUser: vi.fn() }));
import CompleteProfilePage from "./page";

const schoolClass = { id: "class-1", academic_year: 115, class_code: "101", grade: 1, label: "一年一班", is_active: true };
const initial = { required: true, student_id: "510001", current_class: null, class_options: [schoolClass] };

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/profile/complete?next=%2Fshop%3Ftab%3Dorders");
  mocks.myConfirmation.mockResolvedValue(initial);
  mocks.refresh.mockResolvedValue({ id: "student-1", permissions: [], requires_class_confirmation: false });
});

describe("班級確認", () => {
  it("lets a new student select class and seat, then returns to the original page", async () => {
    mocks.confirmClass.mockResolvedValue({ ...initial, required: false });
    render(<CompleteProfilePage />);
    await userEvent.selectOptions(await screen.findByLabelText("班級"), "class-1");
    await userEvent.type(screen.getByLabelText("座號"), "8");
    await userEvent.click(screen.getByRole("button", { name: "儲存班級座號並繼續" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/shop?tab=orders"));
    expect(mocks.confirmClass).toHaveBeenCalledWith({ class_id: "class-1", seat_number: 8 });
  });
  it("prefills an imported class and seat for review", async () => {
    mocks.myConfirmation.mockResolvedValue({ ...initial, current_class: { ...schoolClass, seat_number: 6 } });
    render(<CompleteProfilePage />);
    expect(await screen.findByLabelText("班級")).toHaveValue("class-1");
    expect(screen.getByLabelText("座號")).toHaveValue(6);
    expect(screen.getByRole("button", { name: "確認資料並繼續" })).toBeEnabled();
  });
  it("keeps input and displays a seat conflict without redirecting", async () => {
    mocks.confirmClass.mockRejectedValue(new ApiError(409, "此座號已歸屬其他學生"));
    render(<CompleteProfilePage />);
    await userEvent.selectOptions(await screen.findByLabelText("班級"), "class-1");
    await userEvent.type(screen.getByLabelText("座號"), "5");
    await userEvent.click(screen.getByRole("button", { name: "儲存班級座號並繼續" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("此座號已歸屬其他學生");
    expect(screen.getByLabelText("座號")).toHaveValue(5);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("offers recovery for missing classes and network failure", async () => {
    mocks.myConfirmation.mockRejectedValueOnce(new Error("連線失敗"));
    render(<CompleteProfilePage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    mocks.myConfirmation.mockResolvedValue({ ...initial, class_options: [] });
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(await screen.findByRole("link", { name: "聯絡管理員" })).toHaveAttribute("href", "/contact");
    expect(screen.queryByRole("button", { name: "儲存班級座號並繼續" })).not.toBeInTheDocument();
  });
  it("skips confirmation for an already confirmed user", async () => {
    mocks.myConfirmation.mockResolvedValue({ ...initial, required: false });
    render(<CompleteProfilePage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/shop?tab=orders"));
    expect(mocks.confirmClass).not.toHaveBeenCalled();
  });
  it("keeps the original destination when the session has expired", async () => {
    mocks.myConfirmation.mockRejectedValue(new ApiError(401, "登入已失效"));
    render(<CompleteProfilePage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Fshop%3Ftab%3Dorders"));
  });
});
