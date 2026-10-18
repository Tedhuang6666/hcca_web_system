import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductSeatingPage from "@/app/(protected)/seating/admin/[productId]/page";

const api = vi.hoisted(() => ({ listZones: vi.fn(), getZone: vi.fn(), createZone: vi.fn(), getProduct: vi.fn() }));
const permissions = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/api", () => ({ seatingApi: api, shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("next/navigation", () => ({ useParams: () => ({ productId: "ticket" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => permissions.allowed }) }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/seating/SeatMapEditor", () => ({ default: () => <p>場次座位圖</p> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const zone = { id: "zone", name: "晚場", seat_count: 20, available_count: 18, assigned_count: 2 };

beforeEach(() => {
  vi.resetAllMocks();
  permissions.allowed = true;
  api.getProduct.mockResolvedValue({ id: "ticket", name: "電影票" });
  api.listZones.mockResolvedValue([zone]);
  api.getZone.mockResolvedValue(zone);
});

describe("商品劃位管理", () => {
  it("retries failed sessions and opens the selected session with the keyboard", async () => {
    api.listZones.mockRejectedValueOnce(new Error("offline"));
    render(<ProductSeatingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入場次");
    expect(screen.queryByText(/尚無場次/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新載入場次" }));
    const session = await screen.findByRole("button", { name: "開啟場次：晚場" });
    session.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("場次座位圖")).toBeVisible();
    expect(api.getZone).toHaveBeenCalledWith("zone");
    expect(session).toHaveAttribute("aria-pressed", "true");
  });

  it("prevents repeated submissions while creating a session", async () => {
    let resolveCreate!: (value: typeof zone) => void;
    api.createZone.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    render(<ProductSeatingPage />);
    await screen.findByRole("button", { name: "開啟場次：晚場" });
    fireEvent.click(screen.getByRole("button", { name: "新增場次" }));
    fireEvent.change(screen.getByRole("textbox", { name: "場次名稱" }), { target: { value: "午場" } });
    fireEvent.click(screen.getByRole("button", { name: "建立場次" }));
    const pending = screen.getByRole("button", { name: "建立中…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(api.createZone).toHaveBeenCalledTimes(1);
    await act(async () => resolveCreate(zone));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not load management data for an account without permission", () => {
    permissions.allowed = false;
    render(<ProductSeatingPage />);
    expect(screen.getByText(/目前帳號無法管理劃位/)).toBeVisible();
    expect(api.getProduct).not.toHaveBeenCalled();
    expect(api.listZones).not.toHaveBeenCalled();
  });
});
