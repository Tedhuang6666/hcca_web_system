import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import TeacherPurchaseProfile from "./TeacherPurchaseProfile";

const api = vi.hoisted(() => ({ teacherProfile: vi.fn(), saveTeacherProfile: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_error: unknown, fallback: string) => fallback }));
const office = { id: "office", name: "國文科", is_active: true };
beforeEach(() => {
  vi.resetAllMocks();
  api.teacherProfile.mockResolvedValue({ name: null, office_id: null, office_name: null, offices: [office] });
  api.saveTeacherProfile.mockResolvedValue({ name: "王老師", office_id: "office", office_name: "國文科", offices: [office] });
});

it("saves teacher purchase details and preserves inputs after a failed save", async () => {
  api.saveTeacherProfile.mockRejectedValueOnce(new Error("offline"));
  render(<TeacherPurchaseProfile />);
  fireEvent.change(await screen.findByRole("textbox", { name: "姓名" }), { target: { value: "王老師" } });
  fireEvent.change(screen.getByRole("combobox", { name: "辦公室／處室" }), { target: { value: "office" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存訂購資料" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("訂購資料未儲存");
  expect(screen.getByRole("textbox")).toHaveValue("王老師");
  fireEvent.click(screen.getByRole("button", { name: "儲存訂購資料" }));
  await waitFor(() => expect(api.saveTeacherProfile).toHaveBeenCalledWith({ name: "王老師", office_id: "office" }));
  expect(await screen.findByRole("status")).toHaveTextContent("訂購資料已儲存");
});

it("shows no teacher form for an ineligible account", async () => {
  api.teacherProfile.mockResolvedValue(null);
  const { container } = render(<TeacherPurchaseProfile />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it("requires a new choice when the previously selected office was disabled", async () => {
  api.teacherProfile.mockResolvedValue({ name: "王老師", office_id: "old-office", office_name: "舊處室", offices: [office] });
  render(<TeacherPurchaseProfile />);
  expect(await screen.findByRole("option", { name: "舊處室（已停用，請重新選擇）" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "儲存訂購資料" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "office" } });
  expect(screen.getByRole("button", { name: "儲存訂購資料" })).toBeEnabled();
});

it("recovers from a load error and explains an empty office list", async () => {
  api.teacherProfile.mockRejectedValueOnce(new Error("offline"));
  api.teacherProfile.mockResolvedValueOnce({ name: null, office_id: null, office_name: null, offices: [] });
  render(<TeacherPurchaseProfile />);
  fireEvent.click(await screen.findByRole("button", { name: "重新載入訂購資料" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("目前沒有可選處室"));
  expect(screen.getByRole("button", { name: "儲存訂購資料" })).toBeDisabled();
});
