import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import OrderPromotionSummary from "./OrderPromotionSummary";

it("lists each automatic discount and coupon across grouped orders", () => {
  render(<dl><OrderPromotionSummary orders={[
    { id: "a", discount_amount: 130, promotion_code: "SAVE", applied_promotions: [
      { promotion_id: "one", name: "風衣優惠", code: null, discount_amount: 100 },
      { promotion_id: "two", name: "校慶優惠", code: "SAVE", discount_amount: 30 },
    ] },
    { id: "b", discount_amount: 50, applied_promotions: [
      { promotion_id: "one", name: "風衣優惠", code: null, discount_amount: 50 },
    ] },
  ]} /></dl>);
  expect(screen.getAllByText("優惠折抵（風衣優惠）")).toHaveLength(2);
  expect(screen.getByText("優惠折抵（校慶優惠／SAVE）")).toBeInTheDocument();
  for (const amount of [100, 30, 50]) {
    expect(screen.getByText(`− NT$${amount}`)).toBeInTheDocument();
  }
});

it("keeps legacy discount amounts when details are unavailable", () => {
  render(<dl><OrderPromotionSummary orders={[
    { id: "a", discount_amount: 75, promotion_code: "OLD" },
  ]} /></dl>);
  expect(screen.getByText("優惠折抵（OLD）")).toBeInTheDocument();
  expect(screen.getByText("− NT$75")).toBeInTheDocument();
});

it("shows zero when there are no discounts", () => {
  render(<dl><OrderPromotionSummary orders={[
    { id: "a", discount_amount: 0, applied_promotions: [] },
  ]} /></dl>);
  expect(screen.getByText("優惠折抵")).toBeInTheDocument();
  expect(screen.getByText("− NT$0")).toBeInTheDocument();
});
