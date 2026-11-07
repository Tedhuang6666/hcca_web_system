import type { OrderOut } from "@/lib/types";

type DiscountOrder = Pick<OrderOut, "id" | "applied_promotions" | "promotion_code" | "discount_amount">;

export default function OrderPromotionSummary({ orders }: { orders: DiscountOrder[] }) {
  const discounts = orders.flatMap((order) => order.applied_promotions?.length
    ? order.applied_promotions.map((promotion) => ({
      key: `${order.id}:${promotion.promotion_id}`,
      label: promotion.code ? `${promotion.name}／${promotion.code}` : promotion.name,
      amount: promotion.discount_amount,
    }))
    : order.discount_amount > 0 ? [{
      key: order.id,
      label: order.promotion_code ?? "",
      amount: order.discount_amount,
    }] : []);

  if (!discounts.length) {
    return <div><dt>優惠折抵</dt><dd>− NT$0</dd></div>;
  }

  return discounts.map((discount) => (
    <div key={discount.key}>
      <dt>優惠折抵{discount.label ? `（${discount.label}）` : ""}</dt>
      <dd style={{ color: "var(--success)", whiteSpace: "nowrap" }}>
        − NT${discount.amount.toLocaleString()}
      </dd>
    </div>
  ));
}
