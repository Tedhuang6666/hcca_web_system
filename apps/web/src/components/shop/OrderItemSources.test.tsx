import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OrderItemSources from "./OrderItemSources";
import type { OrderItemOut } from "@/lib/types";

const api = vi.hoisted(() => ({ updateOrderItemQuantity: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (error: Error) => error.message }));
const own: OrderItemOut = { id: "own", product_id: "bag", product_name: "紀念袋", quantity: 1, unit_price: 100, subtotal: 100, selected_options: [], ordered_by_name: "學生" };
const delegated: OrderItemOut = { ...own, id: "mom", quantity: 2, subtotal: 200, delegation_link_id: "link", delegation_name: "給媽媽代訂", ordered_by_name: "媽媽" };

describe("品項代訂來源", () => {
  it("shows each actor and edits only the selected delegated item", async () => {
    api.updateOrderItemQuantity.mockResolvedValue(null);
    const changed = vi.fn();
    render(<OrderItemSources sources={[{ item: own, orderId: "order", canEdit: true }, { item: delegated, orderId: "order", canEdit: true }]} onChange={changed} />);
    expect(screen.getByText("學生登記：1 件")).toBeVisible();
    expect(screen.getByText("給媽媽代訂 · 媽媽代訂：2 件")).toBeVisible();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "移除品項" }));
    await waitFor(() => expect(api.updateOrderItemQuantity).toHaveBeenCalledWith("order", "mom", 0));
    expect(changed).toHaveBeenCalledOnce();
  });

  it("hides quantity controls when the order cannot be edited", () => {
    render(<OrderItemSources sources={[{ item: delegated, orderId: "order", canEdit: false }]} onChange={vi.fn()} />);
    expect(screen.getByText("給媽媽代訂 · 媽媽代訂：2 件")).toBeVisible();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("keeps the original item visible if the update fails", async () => {
    api.updateOrderItemQuantity.mockRejectedValue(new Error("商品已截止"));
    const changed = vi.fn();
    render(<OrderItemSources sources={[{ item: delegated, orderId: "order", canEdit: true }]} onChange={changed} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "更新數量" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("商品已截止");
    expect(screen.getByText("給媽媽代訂 · 媽媽代訂：2 件")).toBeVisible();
    expect(changed).not.toHaveBeenCalled();
  });
});
