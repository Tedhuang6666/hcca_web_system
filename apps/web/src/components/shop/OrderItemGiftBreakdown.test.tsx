import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OrderItemGiftBreakdown from "./OrderItemGiftBreakdown";

const item = { id: "item", product_id: "shirt", quantity: 3, unit_price: 100,
  subtotal: 300, selected_options: [], gift_quantity: 1, gift_discount_amount: 100 };

describe("購買與贈品分列", () => {
  it("三件中一件為贈品，顯示兩件購買與一件贈品且不增加總件數", () => {
    render(<OrderItemGiftBreakdown items={[item]} />);
    expect(screen.getByText("購買 2 件 · NT$200")).toBeVisible();
    expect(screen.getByText("贈品 1 件 · NT$0")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("多件贈品保留規格加價", () => {
    render(<OrderItemGiftBreakdown items={[{ ...item, unit_price: 150, subtotal: 450,
      gift_quantity: 2, gift_discount_amount: 200 }]} />);
    expect(screen.getByText("購買 1 件 · NT$150")).toBeVisible();
    expect(screen.getByText("贈品 2 件 · NT$100（規格加價）")).toBeVisible();
  });

  it("只有贈品時不建立零件的購買列，無贈品時保留原介面", () => {
    const { rerender } = render(<OrderItemGiftBreakdown items={[{ ...item, gift_quantity: 3, gift_discount_amount: 300 }]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    rerender(<OrderItemGiftBreakdown items={[{ ...item, gift_quantity: 0, gift_discount_amount: 0 }]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
