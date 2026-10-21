import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import { bundleProductAvailable, bundleProgress } from "@/lib/shop-bundle-progress";

export default function BundleAddOn({ productId, promotions, products, registration, disabled, onSelect }: {
  productId: string;
  promotions: ShopPromotionPublicOut[];
  products: Map<string, CatalogProductOut>;
  registration: OrderOut | null;
  disabled: boolean;
  onSelect: (promotion: ShopPromotionPublicOut, productId: string) => void;
}) {
  const offers = promotions.filter((promotion) => promotion.discount_type === "bundle_price"
    && promotion.target_products?.some((target) => target.id === productId))
    .map((promotion) => ({ promotion, progress: bundleProgress(promotion, products, registration) }))
    .filter(({ progress }) => progress.started && progress.missing.length > 0);
  if (!offers.length) return null;

  return <section className="shop-bundle-addons" aria-label="套組加購建議">
    <h4>加購湊組更划算</h4>
    {offers.map(({ promotion, progress }) => <div key={promotion.id} className="shop-bundle-addon">
      <strong>{promotion.name}</strong>
      <p role="status">再加購{progress.missing.map((target) => target.name).join("、")}，
        {progress.saving ? `湊齊一套可省 NT$${progress.saving.toLocaleString()}`
          : `組合價 NT$${promotion.discount_value.toLocaleString()}／套`}。</p>
      <div className="shop-bundle-addon-actions">
        {progress.missing.map((target) => target.id === productId
          ? <span key={target.id}>選好本商品的規格與數量，再登記即可湊組。</span>
          : <button key={target.id} type="button"
            disabled={disabled || !bundleProductAvailable(products.get(target.id))}
            onClick={() => onSelect(promotion, target.id)}>
            {bundleProductAvailable(products.get(target.id)) ? `加購${target.name}` : `${target.name}暫停供應`}
          </button>)}
      </div>
      {promotion.min_order_price > 0 && <p>需滿 NT$${promotion.min_order_price.toLocaleString()}。</p>}
      {promotion.min_quantity > 1 && <p>指定商品合計需滿 {promotion.min_quantity} 件。</p>}
      <p>{promotion.code ? `使用優惠碼 ${promotion.code}。` : "符合條件自動套用。"}
        折扣依登記合計擇優套用，規格加價另計。</p>
    </div>)}
  </section>;
}
