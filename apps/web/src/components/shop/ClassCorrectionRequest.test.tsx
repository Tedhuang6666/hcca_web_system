import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassCorrectionRequest from "./ClassCorrectionRequest";

const api = vi.hoisted(() => ({ recipientOptions: vi.fn(), myCorrectionRequests: vi.fn(), createCorrectionRequest: vi.fn() }));
vi.mock("@/lib/api", () => ({ classApi: api, apiErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  api.recipientOptions.mockResolvedValue([{ id: "class", label: "一年一班", academic_year: 115, class_code: "101" }]);
  api.myCorrectionRequests.mockResolvedValue([]);
  api.createCorrectionRequest.mockResolvedValue({ id: "request", status: "pending", requested_class_label: "一年一班" });
});

describe("未歸戶學生的班級申請", () => {
  it("accepts an unassigned student and shows the pending request", async () => {
    render(<ClassCorrectionRequest currentClass={null} />);
    fireEvent.click(screen.getByRole("button", { name: "申請加入班級" }));
    await screen.findByRole("option", { name: "一年一班" });
    fireEvent.change(screen.getByRole("combobox", { name: "你目前就讀的班級" }), { target: { value: "class" } });
    fireEvent.click(screen.getByRole("button", { name: "送出申請" }));
    await waitFor(() => expect(api.createCorrectionRequest).toHaveBeenCalledWith({ requested_class_id: "class", message: null }));
    expect(await screen.findByRole("status")).toHaveTextContent("等待管理員審核");
    expect(screen.queryByRole("button", { name: "申請加入班級" })).not.toBeInTheDocument();
  });

  it("recovers from a failed load without submitting an empty choice", async () => {
    api.recipientOptions.mockRejectedValueOnce(new Error("offline"));
    render(<ClassCorrectionRequest currentClass={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入班級更正資料");
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    await waitFor(() => expect(api.recipientOptions).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "申請加入班級" }));
    expect(screen.getByRole("button", { name: "送出申請" })).toBeDisabled();
  });
});
