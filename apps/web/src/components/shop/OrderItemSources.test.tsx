import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderItemSources from "./OrderItemSources";
import type { OrderItemOut } from "@/lib/types";

const api = vi.hoisted(() => ({ updateOrderItemQuantity: vi.fn(), updateOrderItem: vi.fn(), getProduct: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (error: Error) => error.message }));
const own: OrderItemOut = { id: "own", product_id: "bag", product_name: "紀念袋", quantity: 1, unit_price: 100, subtotal: 100, selected_options: [], ordered_by_name: "學生" };
const delegated: OrderItemOut = { ...own, id: "mom", quantity: 2, subtotal: 200, delegation_link_id: "link", delegation_name: "給媽媽代訂", ordered_by_name: "媽媽" };

beforeEach(() => vi.resetAllMocks());

describe("品項代訂來源", () => {
  it("shows each actor and edits only the selected delegated item", async () => {
    api.updateOrderItemQuantity.mockResolvedValue(null);
    const changed = vi.fn();
    render(<OrderItemSources sources={[{ item: own, orderId: "order", canEdit: true }, { item: delegated, orderId: "order", canEdit: true }]} onChange={changed} />);
    expect(screen.getByText("學生登記：1 件")).toBeVisible();
    expect(screen.getByText("給媽媽代訂 · 媽媽代訂：2 件")).toBeVisible();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
    fireEvent.change(screen.getByRole("spinbutton", { name: "給媽媽代訂 · 媽媽代訂的數量" }), { target: { value: "0" } });
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

  it("edits size and quantity together without changing the saved item until submit", async () => {
    api.getProduct.mockResolvedValue({ price: 100, variant_groups: [{ id: "size", name: "尺寸",
      options: [{ id: "M", value: "M", is_active: true, price_delta: 0 },
        { id: "L", value: "L", is_active: true, price_delta: 20 },
        { id: "XL", value: "XL", is_active: false, price_delta: 0 }] }] });
    api.updateOrderItem.mockRejectedValueOnce(new Error("商品已截止")).mockResolvedValueOnce(null);
    const changed = vi.fn();
    render(<OrderItemSources sources={[{ item: { ...own, selected_options: [{ group_id: "size",
      group_name: "尺寸", option_id: "M", value: "M", price_delta: 0 }] }, orderId: "order", canEdit: true }]} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "修改尺寸／規格" }));
    const size = await screen.findByRole("combobox", { name: "尺寸" });
    expect(size).toHaveValue("M");
    expect(screen.queryByRole("option", { name: "XL" })).not.toBeInTheDocument();
    fireEvent.change(size, { target: { value: "L" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    expect(api.updateOrderItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "儲存修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("商品已截止");
    expect(size).toHaveValue("L");
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
    fireEvent.click(screen.getByRole("button", { name: "儲存修改" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(api.updateOrderItem).toHaveBeenLastCalledWith("order", "own", { quantity: 2, option_ids: ["L"] });
  });

  it("lets users retry loading sizes and discard a draft without saving", async () => {
    api.getProduct.mockRejectedValueOnce(new Error("載入失敗"))
      .mockResolvedValueOnce({ price: 100, variant_groups: [] });
    render(<OrderItemSources sources={[{ item: own, orderId: "order", canEdit: true }]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "修改尺寸／規格" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("載入失敗");
    fireEvent.click(screen.getByRole("button", { name: "修改尺寸／規格" }));
    await screen.findByRole("button", { name: "取消修改" });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(1);
    expect(api.updateOrderItem).not.toHaveBeenCalled();
  });
});
