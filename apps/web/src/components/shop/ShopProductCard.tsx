import Link from "next/link";
import { ArrowUpRight, Gift, Package } from "lucide-react";

import CatalogImage from "@/components/shop/CatalogImage";
import ProductCardOffers from "@/components/shop/ProductCardOffers";
import ShopPrice from "@/components/shop/ShopPrice";
import { uploadUrl } from "@/lib/config";
import type { ShopCardPrice } from "@/lib/shop-card-price";
import { productDeadline } from "@/lib/shop-deadlines";
import type { CatalogProductOut, ShopPromotionPublicOut } from "@/lib/types";

// ── 商品卡片 ──────────────────────────────────────────────────────────────────

export function ProductCard({
  product,
  classClosed,
  councilClosed,
  registeredQuantity,
  canAdjustRegistration,
  href,
  onClick,
  cardPrice,
  promotions,
  products,
  offersLocked,
  onSelectBundle,
  bundleHint,
  featured = false,
}: {
  product: CatalogProductOut;
  classClosed: boolean;
  councilClosed: boolean;
  registeredQuantity: number;
  canAdjustRegistration: boolean;
  href: string | null;
  onClick: () => void;
  cardPrice: ShopCardPrice;
  promotions: ShopPromotionPublicOut[];
  products: Map<string, CatalogProductOut>;
  offersLocked: boolean;
  onSelectBundle: (promotion: ShopPromotionPublicOut) => void;
  bundleHint: string | null;
  featured?: boolean;
}) {
  const testing = product.status === "testing";
  const soldOut = product.status === "sold_out" || (testing && !product.is_unlimited && product.stock_quantity === 0);
  const deadline = productDeadline(product);
  const deadlinePassed = !testing && Boolean(deadline && new Date(deadline).getTime() <= Date.now());
  const locked = (!testing && (classClosed || councilClosed)) || deadlinePassed;
  const disabled = (soldOut || locked) && registeredQuantity === 0;
  const detailsDisabled = disabled && !(classClosed && !councilClosed);
  const statusLabel = product.purchase_allowed === false
    ? product.purchase_restriction ?? "購買資格受限"
    : testing
    ? "測試中・正式開放時清除試訂紀錄"
    : councilClosed
      ? "班聯已結單"
      : classClosed
    ? "班聯已確認本班收款"
    : deadlinePassed
      ? "登記已截止"
      : registeredQuantity > 0
        ? `已登記 ${registeredQuantity} 件`
        : soldOut
          ? "已售完"
          : null;
  const className = "shop-public-product-card group";
  const style = { opacity: disabled ? 0.6 : 1 };
  const coverUrl = product.image_url;
  const content = (
    <>
      <div className="shop-public-product-media">
        {coverUrl ? (
          <CatalogImage
            src={uploadUrl(coverUrl)}
            alt={product.name}
            sizes={featured
              ? "(max-width: 760px) calc(100vw - 2rem), (max-width: 1199px) 55vw, 640px"
              : "(max-width: 759px) calc((100vw - 3rem) / 2), (max-width: 1199px) calc((100vw - 5rem) / 3), 360px"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ color: "var(--public-muted)" }}>
            <Package size={38} strokeWidth={1.2} aria-hidden="true" />
          </div>
        )}
        {statusLabel && (
          <span
            className="shop-public-product-status"
            data-sold-out={soldOut || undefined}>
            {statusLabel}
          </span>
        )}
      </div>
      <div className="shop-public-product-info">
        <div className="shop-public-product-heading">
          <h4>{product.name}</h4>
          {!disabled && <ArrowUpRight size={16} aria-hidden="true" />}
        </div>
        <div className="shop-public-product-meta">
          <span className="shop-public-product-price">
            <ShopPrice original={cardPrice.original} current={cardPrice.current} suffix={!cardPrice.note && product.has_option_surcharge ? " 起" : undefined} />
          </span>
          {!product.is_unlimited && !soldOut && (
            <span className="shop-public-product-deadline">剩 {product.stock_quantity}</span>
          )}
        </div>
        {cardPrice.note && <p className="shop-public-product-deadline">{cardPrice.note}</p>}
        {deadline && (
          <p className="shop-public-product-deadline">
            截止 {new Date(deadline).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
          </p>
        )}
        <span className={registeredQuantity > 0 ? "shop-public-product-action" : "sr-only"}>
          {disabled
            ? statusLabel
            : registeredQuantity > 0
              ? canAdjustRegistration && !locked ? "調整規格與數量" : "查看已登記商品"
              : "選擇商品"}
          {!disabled && <ArrowUpRight size={16} aria-hidden="true" />}
        </span>
      </div>
    </>
  );

  return <article className="shop-public-product-entry" data-bundle-addon={Boolean(bundleHint) || undefined} aria-label={`${product.name}商品`}>
    {bundleHint && <p className="shop-product-bundle-hint"><Gift size={16} aria-hidden="true" />{bundleHint}</p>}
    {href ? (
      <Link
        href={href}
        prefetch={false}
        onClick={(event) => {
          if (detailsDisabled) {
            event.preventDefault();
            return;
          }
          if ((event.button !== undefined && event.button !== 0)
            || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onClick();
        }}
        aria-disabled={detailsDisabled || undefined}
        tabIndex={detailsDisabled ? -1 : undefined}
        className={className}
        style={style}
        aria-label={`查看商品：${product.name}`}>
        {content}
      </Link>
    ) : (
      <button
        type="button"
        onClick={onClick}
        disabled={detailsDisabled}
        className={className}
        style={style}
        aria-label={`查看商品：${product.name}`}>
        {content}
      </button>
    )}
    <ProductCardOffers product={product} promotions={promotions} products={products}
      disabled={disabled || offersLocked || product.purchase_allowed === false} onSelectBundle={onSelectBundle} />
  </article>;
}

// ── 購買頁 ────────────────────────────────────────────────────────────────────
