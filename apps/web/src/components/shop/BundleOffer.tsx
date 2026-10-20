import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import ShopPrice from "./ShopPrice";

export default function BundleOffer({ promotion, products, registration, disabled, onSelect }: {
  promotion: ShopPromotionPublicOut;
  products: Map<string, CatalogProductOut>;
  registration: OrderOut | null;
  disabled: boolean;
  onSelect: (productId: string) => void;
}) {
  const targets = promotion.target_products ?? [];
  const original = targets.reduce((sum, target) => sum + (products.get(target.id)?.price ?? 0), 0);
  const quantities = new Map<string, number>();
  for (const item of registration?.items ?? []) {
    quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity);
  }
  const missing = targets.filter((target) => !quantities.get(target.id));
  const complete = targets.length > 0 && missing.length === 0;
  const unavailable = targets.some((target) => {
    const product = products.get(target.id);
    return !product || product.status !== "active"
      || (product.sale_end != null && new Date(product.sale_end).getTime() <= Date.now());
  });
  const applied = registration?.applied_promotions?.some((row) => row.promotion_id === promotion.id)
    || registration?.promotion_id === promotion.id;
  const next = missing[0] ?? targets[0];
  return <article className="shop-bundle-offer" aria-label={promotion.name}>
    <div className="shop-bundle-heading">
      <div><h3>{promotion.name}</h3><p>一起買更划算，每項各一件自由選規格</p></div>
      <div className="shop-bundle-price">
        <ShopPrice original={original} current={promotion.discount_value} suffix="／套" />
        {original > promotion.discount_value && <strong>每套省 NT${(original - promotion.discount_value).toLocaleString()}</strong>}
      </div>
    </div>
    <ul className="shop-bundle-products">
      {targets.map((target) => <li key={target.id}>
        <button type="button" disabled={disabled || !products.has(target.id)} onClick={() => onSelect(target.id)}>
          <span>{target.name}</span><span>{quantities.get(target.id) ? "已選，可修改規格" : "選擇規格與數量"}</span>
        </button>
      </li>)}
    </ul>
    <div className="shop-bundle-footer">
      <p role="status">{applied ? "已套用套組優惠" : complete ? "已選齊套組商品，折扣依登記合計擇優套用。"
        : `還差 ${missing.map((target) => target.name).join("、")}，選齊即可享組合價。`}
        {promotion.code ? ` 使用優惠碼 ${promotion.code}。` : " 符合條件自動套用。"}
        {promotion.min_order_price > 0 && ` 需滿 NT$${promotion.min_order_price.toLocaleString()}。`}
        {promotion.min_quantity > 1 && ` 指定商品合計需滿 ${promotion.min_quantity} 件。`}
        {" "}規格加價與未成套商品另計。</p>
      <button type="button" className="shop-bundle-start" disabled={disabled || unavailable || !next}
        onClick={() => next && onSelect(next.id)}>
        {unavailable ? "套組商品暫停供應" : complete ? "查看套組商品" : missing.length === targets.length ? "開始選購套組" : "繼續選購套組"}
      </button>
    </div>
  </article>;
}
