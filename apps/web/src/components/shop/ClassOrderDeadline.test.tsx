import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ClassOrderDeadline from "./ClassOrderDeadline";

const api = vi.hoisted(() => ({ getClassDeadline: vi.fn(), closeCategory: vi.fn(), reopenCategory: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

it("saves a Taipei class deadline and cancels only this class setting", async () => {
  api.getClassDeadline.mockResolvedValue(null);
  api.closeCategory.mockResolvedValue({ id: "close", closes_at: "2026-11-01T04:00:00Z" });
  api.reopenCategory.mockResolvedValue({});
  const saved = vi.fn();
  render(<ClassOrderDeadline classId="class" categories={[{ id: "cat", name: "紀念品", sort_order: 0, products: [], series: [] }]} onSaved={saved} />);
  fireEvent.click(screen.getByText("本班截止時間"));
  const input = screen.getByLabelText("本班截止時間（臺北時間）");
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "2026-11-01T12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存本班截止時間" }));
  await waitFor(() => expect(api.closeCategory).toHaveBeenCalledWith("cat", { class_id: "class", closes_at: "2026-11-01T04:00:00.000Z" }));
  fireEvent.click(await screen.findByRole("button", { name: "取消本班截止" }));
  await waitFor(() => expect(api.reopenCategory).toHaveBeenCalledWith("cat", "class"));
  expect(saved).toHaveBeenCalledTimes(2);
});
