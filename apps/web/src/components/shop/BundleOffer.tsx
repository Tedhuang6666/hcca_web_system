import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import ShopPrice from "./ShopPrice";
import { bundleProductAvailable, bundleProgress } from "@/lib/shop-bundle-progress";

export default function BundleOffer({ promotion, products, registration, disabled, onSelect, scopeName }: {
  promotion: ShopPromotionPublicOut;
  products: Map<string, CatalogProductOut>;
  registration: OrderOut | null;
  disabled: boolean;
  onSelect: (productId: string) => void;
  scopeName?: string;
}) {
  const targets = promotion.target_products ?? [];
  const { original, quantities, missing, started, completedSets, unavailable, saving } = bundleProgress(promotion, products, registration);
  const complete = targets.length > 0 && missing.length === 0;
  const applied = registration?.applied_promotions?.some((row) => row.promotion_id === promotion.id)
    || registration?.promotion_id === promotion.id;
  const next = missing[0] ?? targets[0];
  return <article className="shop-bundle-offer" data-started={started || undefined} aria-label={promotion.name}>
    <div className="shop-bundle-heading">
      <div><h3>{promotion.name}</h3><p>{scopeName && `${scopeName} · `}每項各一件，自由選規格</p></div>
      <div className="shop-bundle-price">
        <ShopPrice original={original ?? promotion.discount_value} current={promotion.discount_value} suffix="／套" />
        {saving != null && saving > 0 && <strong>每套省 NT${saving.toLocaleString()}</strong>}
      </div>
    </div>
    <ul className="shop-bundle-products">
      {targets.map((target) => <li key={target.id}>
        <button type="button" data-selected={Boolean(quantities.get(target.id)) || undefined}
          disabled={disabled || (!quantities.get(target.id) && !bundleProductAvailable(products.get(target.id)))} onClick={() => onSelect(target.id)}>
          <span>{target.name}</span><span>{quantities.get(target.id)
            ? `已選 ${quantities.get(target.id)} 件，可修改規格` : "選擇規格與數量"}</span>
        </button>
      </li>)}
    </ul>
    <div className="shop-bundle-footer">
      <p role="status">{completedSets > 0 && `已湊齊 ${completedSets} 套。`}
        {started ? `還差 ${missing.map((target) => target.name).join("、")} 各 1 件，${completedSets > 0 ? "再" : ""}湊一套享組合價。`
          : applied ? "已套用套組優惠" : complete ? "已選齊套組商品，折扣依登記合計擇優套用。"
            : `還差 ${missing.map((target) => target.name).join("、")}，選齊即可享組合價。`}
        {promotion.code ? ` 使用優惠碼 ${promotion.code}。` : " 符合條件自動套用。"}
        {promotion.min_order_price > 0 && ` 需滿 NT$${promotion.min_order_price.toLocaleString()}。`}
        {promotion.min_quantity > 1 && ` 指定商品合計需滿 ${promotion.min_quantity} 件。`}
        {" "}規格加價與未成套商品另計。</p>
      <button type="button" className="shop-bundle-start" disabled={disabled || unavailable || !next}
        onClick={() => next && onSelect(next.id)}>
        {unavailable ? "套組商品暫停供應" : complete ? "查看套組商品" : started ? "加購湊齊套組" : "開始選購套組"}
      </button>
    </div>
  </article>;
}
