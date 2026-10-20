import type { CatalogProductOut, ShopPromotionPublicOut } from "@/lib/types";
import ShopPrice from "./ShopPrice";

export default function ProductCardOffers({ product, promotions, products, disabled, onSelectBundle }: {
  product: CatalogProductOut;
  promotions: ShopPromotionPublicOut[];
  products: Map<string, CatalogProductOut>;
  disabled: boolean;
  onSelectBundle: (promotion: ShopPromotionPublicOut) => void;
}) {
  const matching = promotions.filter((promotion) => {
    const targets = promotion.target_products ?? [];
    return targets.length === 0 || targets.some((target) => target.id === product.id);
  });
  if (matching.length === 0) return null;

  return <div className="shop-product-card-offers" aria-label={`${product.name}可用優惠`}>
    {matching.map((promotion) => {
      const targets = promotion.target_products ?? [];
      const isBundle = promotion.discount_type === "bundle_price";
      const companions = targets.filter((target) => target.id !== product.id);
      const bundleProducts = targets.map((target) => products.get(target.id));
      const original = isBundle
        ? bundleProducts.every((target) => target != null)
          ? bundleProducts.reduce((sum, target) => sum + (target?.price ?? 0), 0)
          : promotion.discount_value
        : product.price;
      const override = promotion.product_price_overrides?.find((row) => row.product_id === product.id);
      const singlePrice = promotion.discount_type === "price_override" ? override?.unit_price
        : promotion.discount_type === "percentage" && targets.length <= 1
          ? original - Math.floor(original * promotion.discount_value / 100)
          : promotion.discount_type === "fixed" && targets.length <= 1
            && promotion.min_quantity <= 1 && promotion.min_order_price <= original
            ? Math.max(0, original - promotion.discount_value)
            : null;
      const conditions = [
        promotion.min_order_price > 0 ? `滿 NT$${promotion.min_order_price.toLocaleString()}` : null,
        promotion.min_quantity > 1 ? `滿 ${promotion.min_quantity} 件` : null,
        promotion.code ? `使用優惠碼 ${promotion.code}` : "符合條件自動套用",
      ].filter(Boolean).join(" · ");
      const unavailable = isBundle && bundleProducts.some((target) => !target
        || target.status !== "active"
        || (target.sale_end != null && new Date(target.sale_end).getTime() <= Date.now()));
      return <div className="shop-product-card-offer" key={promotion.id}>
        <strong>{promotion.name}</strong>
        {isBundle ? <>
          <p>搭配{companions.map((target) => target.name).join("、")}，每項各一件</p>
          <ShopPrice original={original} current={promotion.discount_value} suffix="／套" />
          {original > promotion.discount_value && <p className="shop-product-card-saving">
            每套省 NT${(original - promotion.discount_value).toLocaleString()}
          </p>}
        </> : singlePrice != null ? <>
          <p>{promotion.discount_type === "fixed" ? "單件購買價（每筆折抵一次）"
            : promotion.code || promotion.min_quantity > 1 || promotion.min_order_price > original
              ? "符合條件時單件價" : "單件優惠價"}</p>
          <ShopPrice original={original} current={singlePrice} suffix={product.has_variants ? " 起" : undefined} />
        </> : <p>{promotion.discount_type === "percentage"
          ? `指定商品合購減價 ${promotion.discount_value}%`
          : `整筆登記折抵 NT$${promotion.discount_value.toLocaleString()}`}</p>}
        {!isBundle && promotion.discount_type !== "price_override" && companions.length > 0
          && <p>需同時選購{companions.map((target) => target.name).join("、")}</p>}
        <p>{conditions}{isBundle || promotion.discount_type === "price_override" ? " · 規格加價另計" : ""}</p>
        {isBundle && <button type="button" disabled={disabled || unavailable}
          onClick={() => onSelectBundle(promotion)}>
          {unavailable ? "套組暫停供應" : "選購此套組"}
        </button>}
      </div>;
    })}
  </div>;
}
