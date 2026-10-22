import { ArrowUpRight } from "lucide-react";
import type { CatalogProductOut, ShopPromotionPublicOut } from "@/lib/types";
import ShopPrice from "./ShopPrice";
import { productOrderable } from "@/lib/shop-deadlines";

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
  const bundleCount = matching.filter((promotion) => promotion.discount_type === "bundle_price").length;

  return <div className="shop-product-card-offers" aria-label={`${product.name}可用優惠`}>
    {bundleCount > 1 && <a className="shop-product-card-bundle" href="#shop-bundles-title">
      查看 {bundleCount} 組套組優惠<ArrowUpRight size={15} aria-hidden="true" />
    </a>}
    {matching.filter((promotion) => bundleCount <= 1 || promotion.discount_type !== "bundle_price").map((promotion) => {
      const targets = promotion.target_products ?? [];
      const isBundle = promotion.discount_type === "bundle_price";
      if (isBundle) {
        const unavailable = targets.some((target) => {
          const bundleProduct = products.get(target.id);
          return !bundleProduct || !productOrderable(bundleProduct, Date.now());
        });
        return <button key={promotion.id} type="button" className="shop-product-card-bundle"
          aria-label={`選購套組：${promotion.name}`} disabled={disabled || unavailable}
          onClick={() => onSelectBundle(promotion)}>
          {unavailable ? "套組暫停供應" : "選購套組"}
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>;
      }
      const companions = targets.filter((target) => target.id !== product.id);
      const original = product.price;
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
      return <div className="shop-product-card-offer" key={promotion.id}>
        <strong>{promotion.name}</strong>
        {singlePrice != null ? <>
          <p>{promotion.discount_type === "fixed" ? "單件購買價（每筆折抵一次）"
            : promotion.code || promotion.min_quantity > 1 || promotion.min_order_price > original
              ? "符合條件時單件價" : "單件優惠價"}</p>
          <ShopPrice original={original} current={singlePrice} suffix={product.has_variants ? " 起" : undefined} />
        </> : <p>{promotion.discount_type === "percentage"
          ? `指定商品合購減價 ${promotion.discount_value}%`
          : `整筆登記折抵 NT$${promotion.discount_value.toLocaleString()}`}</p>}
        {promotion.discount_type !== "price_override" && companions.length > 0
          && <p>需同時選購{companions.map((target) => target.name).join("、")}</p>}
        <p>{conditions}{promotion.discount_type === "price_override" ? " · 規格加價另計" : ""}</p>
      </div>;
    })}
  </div>;
}
