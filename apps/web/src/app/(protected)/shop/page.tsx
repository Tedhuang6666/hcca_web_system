"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Package, ShoppingBag } from "lucide-react";
import { authApi, classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type {
  CatalogCategoryOut,
  CatalogProductOut,
  CloseStatusItem,
  ProductOut,
  MyClassContext,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePersistedState } from "@/hooks/usePersistedState";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";
import { addGuestCartItem, getGuestCart, guestCartCount } from "@/lib/shop-guest-cart";
import ClassCorrectionRequest from "@/components/shop/ClassCorrectionRequest";

function Thumb({ url, alt, size = 64 }: { url: string | null; alt: string; size?: number }) {
  if (!url) {
    return (
      <div
        className="rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        aria-hidden="true">
        <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" style={{ color: "var(--text-disabled)" }}>
          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 21" />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={uploadUrl(url)}
      alt={alt}
      width={size}
      height={size}
      className="rounded-lg object-cover flex-shrink-0"
      style={{ width: size, height: size, border: "1px solid var(--border)" }}
    />
  );
}

// ── 商品變體選購 Modal ────────────────────────────────────────────────────────

function ProductModal({
  productId,
  classClosed,
  isLoggedIn,
  directPurchaseOnly,
  onClose,
  onAdded,
}: {
  productId: string;
  classClosed: boolean;
  isLoggedIn: boolean;
  directPurchaseOnly: boolean;
  onClose: () => void;
  onAdded: (goToCart: boolean) => void;
}) {
  const [product, setProduct] = useState<ProductOut | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(true);
  const [productLoadError, setProductLoadError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const loadProduct = useCallback(async () => {
    setProduct(null);
    setPicked({});
    setSelectedMediaIndex(null);
    setQty(1);
    setProductLoading(true);
    setProductLoadError(false);
    try {
      setProduct(await shopApi.getProduct(productId));
    } catch {
      setProductLoadError(true);
    } finally {
      setProductLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  const variantGroups = product?.variant_groups ?? [];
  const media = product
    ? [
        ...(product.image_url ? [{ image_url: product.image_url, kind: "cover" as const }] : []),
        ...(product.media ?? []).map((item) => ({
          image_url: item.image_url,
          kind: item.kind,
        })),
      ]
    : [];
  const delta = variantGroups.reduce((sum, g) => {
    const opt = (g.options ?? []).find((o) => o.id === picked[g.id]);
    return sum + (opt?.price_delta ?? 0);
  }, 0);
  const unitPrice = (product?.price ?? 0) + delta;
  const allPicked = variantGroups.every((g) => picked[g.id]);
  const available =
    Boolean(product && product.status === "active" && (product.is_unlimited || product.stock_quantity > 0));
  const guestCartQuantity = product && !isLoggedIn
    ? getGuestCart()
        .filter((item) => item.product_id === product.id)
        .reduce((total, item) => total + item.quantity, 0)
    : 0;
  const remainingForUser = product?.max_quantity_per_user == null
    ? null
    : Math.max(
        0,
        (product.remaining_quantity_for_user ?? product.max_quantity_per_user) - guestCartQuantity,
      );
  const maxSelectableQuantity = product
    ? Math.max(
        0,
        Math.min(
          100,
          product.is_unlimited ? 100 : product.stock_quantity,
          remainingForUser ?? 100,
        ),
      )
    : 0;
  const purchaseLimitReached = remainingForUser === 0;
  const canAddToCart = available && !classClosed && maxSelectableQuantity > 0;
  const variantImage = variantGroups.reduce<string | null>((current, group) => {
    const option = (group.options ?? []).find((o) => o.id === picked[group.id]);
    return option?.image_url || current;
  }, null);
  const selectedMedia = selectedMediaIndex === null ? null : media[selectedMediaIndex] ?? null;
  const displayMedia = selectedMedia ?? (variantImage
    ? { image_url: variantImage, kind: "option" as const }
    : media[0] ?? null);
  const displayLabel = displayMedia?.kind === "model"
    ? "模特兒宣傳照"
    : displayMedia?.kind === "option"
      ? "所選規格"
      : displayMedia?.kind === "cover"
        ? "商品主圖"
        : "商品照片";

  const submit = async (goToCart: boolean) => {
    if (!product) return;
    if (classClosed) {
      toast.error("本班已結單，請聯繫班級幹部確認訂購安排");
      return;
    }
    if (maxSelectableQuantity === 0 || qty > maxSelectableQuantity) {
      toast.error(purchaseLimitReached ? "此帳號已達商品購買上限" : "可購買數量已更新，請重新選擇");
      return;
    }
    if (!allPicked) {
      toast.error("請選擇所有規格");
      return;
    }
    setLoading(true);
    try {
      if (isLoggedIn) {
        await shopApi.addCartItem({
          product_id: product.id,
          quantity: qty,
          option_ids: Object.values(picked),
        });
      } else {
        addGuestCartItem(product, qty, Object.values(picked));
      }
      toast.success(goToCart ? "已加入購物車，前往購物車確認訂單" : "已加入購物車");
      onAdded(goToCart);
    } catch (e) {
      toast.error(apiErrorMessage(e, "加入失敗"));
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="shop-product-dialog-overlay public-site" style={{ background: "var(--bg-overlay)" }}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
        tabIndex={-1}
        className="shop-product-dialog min-w-0 animate-scale-in">
        <div className="shop-product-dialog-media">
          {product && displayMedia ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadUrl(displayMedia.image_url)}
              alt={`${product.name}・${displayLabel}`}
            />
          ) : (
            <div className="shop-product-dialog-placeholder">
              <Package size={48} strokeWidth={1.2} aria-hidden="true" />
            </div>
          )}
          {product && displayMedia && (
            <p className="shop-product-dialog-image-caption">{displayLabel}</p>
          )}
          {product && media.length > 1 && (
            <div className="shop-product-dialog-gallery" role="group" aria-label="商品圖片">
              {media.map((item, index) => {
                const label = item.kind === "model"
                  ? "模特兒宣傳照"
                  : item.kind === "cover"
                    ? "商品主圖"
                    : "商品照片";
                const selected = selectedMediaIndex === index || (
                  selectedMediaIndex === null && index === 0 && !variantImage
                );
                return (
                  <button
                    key={`${item.image_url}-${index}`}
                    type="button"
                    onClick={() => setSelectedMediaIndex(index)}
                    aria-label={`顯示${label} ${index + 1}`}
                    aria-pressed={selected}
                    className="shop-product-dialog-gallery-item">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={uploadUrl(item.image_url)} alt="" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="shop-product-dialog-content">
          <button ref={closeButtonRef} onClick={onClose} className="shop-product-dialog-close topbar-icon-btn" aria-label="關閉">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {productLoading && (
            <div className="shop-product-dialog-state" role="status" aria-live="polite">
              <h3 id="product-modal-title">載入商品詳情</h3>
              <p>正在取得商品與圖片資料…</p>
            </div>
          )}
          {productLoadError && (
            <div className="shop-product-dialog-state" role="alert">
              <CircleAlert size={22} aria-hidden="true" />
              <h3 id="product-modal-title">商品詳情載入失敗</h3>
              <p>商品資料暫時無法取得，請重新載入。</p>
              <button type="button" onClick={() => void loadProduct()} className="shop-product-retry">
                重新載入
              </button>
            </div>
          )}
          {product && !productLoading && !productLoadError && (
            <>
              <div className="shop-product-dialog-heading">
                <h3 id="product-modal-title">{product.name}</h3>
                {product.description && <p className="whitespace-pre-line">{product.description}</p>}
                {!product.is_unlimited && product.status === "active" && (
                  <p className="shop-product-dialog-stock">剩餘 {product.stock_quantity} 件</p>
                )}
                {product.max_quantity_per_user != null && (
                  <p className="shop-product-dialog-stock">
                    每人限購 {product.max_quantity_per_user} 件
                    {remainingForUser != null && ` · 此帳號尚可選 ${remainingForUser} 件`}
                  </p>
                )}
              </div>

              {variantGroups.map((g) => (
                <div key={g.id} className="shop-product-dialog-section">
                  <label>{g.name}</label>
                  <div className="shop-product-options">
                    {(g.options ?? [])
                      .filter((o) => o.is_active)
                      .map((o) => {
                        const sel = picked[g.id] === o.id;
                        return (
                          <button
                            key={o.id}
                            onClick={() => {
                              setSelectedMediaIndex(null);
                              setPicked((p) => ({ ...p, [g.id]: o.id }));
                            }}
                            className="shop-product-option"
                            aria-pressed={sel}>
                            {o.image_url && <Thumb url={o.image_url} alt={o.value} size={28} />}
                            <span>{o.value}</span>
                            {o.price_delta !== 0 && (
                              <span className="shop-product-option-price">
                                {o.price_delta > 0 ? `+${o.price_delta}` : o.price_delta}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}

              <div className="shop-product-dialog-section">
                <label>數量</label>
                {maxSelectableQuantity === 0 ? (
                  <p className="text-sm" style={{ color: "var(--public-secondary)" }}>
                    {purchaseLimitReached ? "此帳號已達購買上限。" : "目前沒有可選數量。"}
                  </p>
                ) : product.max_quantity_per_user === 1 ? (
                  <p className="text-sm" style={{ color: "var(--public-secondary)" }}>每人限購 1 件</p>
                ) : (
                  <div className="shop-product-quantity">
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      disabled={qty <= 1}
                      aria-label="減少數量">−</button>
                    <span>{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.min(maxSelectableQuantity, q + 1))}
                      disabled={qty >= maxSelectableQuantity}
                      aria-label="增加數量">＋</button>
                  </div>
                )}
              </div>

              <p className="shop-product-purchase-hint">
                直接購買會前往購物車；加入購物車會留在此頁。
              </p>
              <div className={`shop-product-dialog-actions${directPurchaseOnly ? "" : " shop-product-dialog-actions--split"}`}>
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={loading || !canAddToCart}
                  className="shop-product-submit"
                  aria-busy={loading}>
                  {!available
                    ? "目前無法訂購"
                    : classClosed
                      ? "本班已結單"
                      : loading
                        ? "處理中…"
                        : purchaseLimitReached
                          ? "已達購買上限"
                          : `直接購買 · NT$${(unitPrice * qty).toLocaleString()}`}
                </button>
                {!directPurchaseOnly && (
                  <button
                    type="button"
                    onClick={() => submit(false)}
                    disabled={loading || !canAddToCart}
                    className="shop-product-add-to-cart"
                    aria-busy={loading}>
                    {loading ? "處理中…" : "加入購物車"}
                  </button>
                )}
                <button type="button" onClick={onClose} className="shop-product-cancel">取消</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 商品卡片 ──────────────────────────────────────────────────────────────────

function ProductCard({
  product,
  classClosed,
  onClick,
}: {
  product: CatalogProductOut;
  classClosed: boolean;
  onClick: () => void;
}) {
  const soldOut = product.status === "sold_out";
  const statusLabel = classClosed ? "本班已結單" : soldOut ? "已售完" : null;
  return (
    <button
      onClick={onClick}
      disabled={soldOut || classClosed}
      className="shop-public-product-card group"
      style={{
        opacity: soldOut || classClosed ? 0.6 : 1,
      }}
      aria-label={`查看商品：${product.name}`}>
      <div className="shop-public-product-media">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={uploadUrl(product.image_url)}
            alt={product.name}
            className="h-full w-full object-cover"
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
        <h4>
          {product.name}
        </h4>
        <div className="shop-public-product-meta">
          <span className="shop-public-product-price">
            NT${product.price.toLocaleString()}
            {product.has_variants && (
              <small> 起</small>
            )}
          </span>
          {!product.is_unlimited && !soldOut && (
            <span className="shop-public-product-deadline">剩 {product.stock_quantity}</span>
          )}
        </div>
        {product.sale_end && (
          <p className="shop-public-product-deadline">
            截止 {new Date(product.sale_end).toLocaleString("zh-TW")}
          </p>
        )}
      </div>
    </button>
  );
}

// ── 購買頁 ────────────────────────────────────────────────────────────────────

export default function ShopPage() {
  const router = useRouter();
  const catalogCacheKey = "shop/catalog/all:v2";

  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>(() => cacheGet<CatalogCategoryOut[]>(catalogCacheKey) ?? []);
  const [loading, setLoading] = useState(!cacheHas(catalogCacheKey));
  const [loadError, setLoadError] = useState(false);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [directOrderProductId, setDirectOrderProductId] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [cartButtonBump, setCartButtonBump] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [myClass, setMyClass] = useState<MyClassContext | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = usePersistedState<string | null>("hcca:pref:shop:category:v1", null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const closeProduct = useCallback(() => {
    setOpenProduct(null);
    setDirectOrderProductId(null);
  }, []);

  const loadCatalog = useCallback(() => {
    if (!cacheHas(catalogCacheKey)) setLoading(true);
    setLoadError(false);
    shopApi
      .catalog()
      .then(async (data) => {
        setCatalog(data);
        cacheSet(catalogCacheKey, data);
        setSelectedCategoryId((current) => current ?? data[0]?.id ?? null);
        try {
          const schoolClass = await classApi.myClass();
          if (schoolClass && data.length) {
            setMyClass(schoolClass);
            const catIds = data.map((c) => c.id);
            const status = await shopApi.getCloseStatus(catIds, schoolClass.id);
            setCloseStatus(status.statuses);
          } else {
            setMyClass(null);
          }
        } catch {
          setMyClass(null);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [setSelectedCategoryId, catalogCacheKey]);

  const loadCart = useCallback(() => {
    if (!isLoggedIn) {
      setCartCount(guestCartCount());
      return;
    }
    shopApi
      .getCart()
      .then((c) => setCartCount(c.items.reduce((n, i) => n + i.quantity, 0)))
      .catch(() => {});
  }, [isLoggedIn]);

  useEffect(() => {
    loadCatalog();
    void authApi.me()
      .then(() => setIsLoggedIn(true))
      .catch(() => setIsLoggedIn(false));
  }, [loadCatalog]);

  useEffect(() => {
    const productId = new URLSearchParams(window.location.search).get("product");
    if (!productId || catalog.length === 0) return;
    const category = catalog.find((item) =>
      item.products.some((product) => product.id === productId)
      || item.series.some((series) => series.products.some((product) => product.id === productId))
    );
    if (!category) return;
    setSelectedCategoryId(category.id);
    setSelectedSeriesId(null);
    setDirectOrderProductId(productId);
    setOpenProduct(productId);
  }, [catalog, setSelectedCategoryId, setDirectOrderProductId]);

  useEffect(() => { loadCart(); }, [loadCart]);

  useEffect(() => {
    const refreshGuestCart = () => {
      if (!isLoggedIn) setCartCount(guestCartCount());
    };
    window.addEventListener("hcca:guest-cart-updated", refreshGuestCart);
    return () => window.removeEventListener("hcca:guest-cart-updated", refreshGuestCart);
  }, [isLoggedIn]);

  const selectedCategory =
    catalog.find((category) => category.id === selectedCategoryId) ?? catalog[0] ?? null;

  const selectedActivityProductCount = selectedCategory
    ? catalog
        .filter((category) => selectedCategory.activity_id
          ? category.activity_id === selectedCategory.activity_id
          : category.id === selectedCategory.id)
        .reduce(
          (count, category) => count + category.products.length
            + category.series.reduce((seriesCount, series) => seriesCount + series.products.length, 0),
          0,
        )
    : 0;

  const visibleSeries = selectedCategory?.series.filter(
    (series) => !selectedSeriesId || series.id === selectedSeriesId,
  ) ?? [];

  return (
    <div className="shop-public-page">
      <header className="shop-public-hero">
        <div>
          <h1>商品訂購</h1>
          <p className="shop-public-hero-copy">
            挑選目前開放的商品，確認規格後加入購物車；登入只在送出訂單時需要。
          </p>
        </div>
        <div className="shop-public-hero-actions">
          <Link href="/shop/orders" className="shop-public-order-link">我的訂單</Link>
          <Link
            href="/shop/cart"
            className={`shop-public-cart-link${cartButtonBump ? " motion-safe:animate-bounce" : ""}`}>
            <ShoppingBag size={16} aria-hidden="true" />
            購物車{cartCount > 0 ? `（${cartCount}）` : ""}
          </Link>
        </div>
      </header>

      {myClass && (
        <section
          className="shop-public-context"
          aria-label="班級歸戶資訊"
          data-closed={Object.values(closeStatus).some((status) => status.is_closed) || undefined}>
          {Object.values(closeStatus).some((status) => status.is_closed)
            ? <CircleAlert size={18} style={{ color: "var(--danger)" }} aria-hidden />
            : <CircleCheck size={18} style={{ color: "var(--success)" }} aria-hidden />}
          <div>
            <p>
              <strong>
                你的帳號已被歸戶至「{myClass.label ?? `${myClass.academic_year} 學年度 ${myClass.class_code} 班`}」
              </strong>
            </p>
            <p>{myClass.seat_number ? `座號：${myClass.seat_number} 號` : "座號尚未登錄"}</p>
            <p>
              送單後請向班級幹部繳費；幹部確認收款後，會在「我的訂單」更新為已繳費。
            </p>
            {isLoggedIn && <ClassCorrectionRequest currentClass={myClass} />}
          </div>
        </section>
      )}

      {loadError && (
        <div role="alert" className="shop-public-alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>目前無法載入商品，請稍後重試。</p>
          <button type="button" onClick={loadCatalog} className="btn btn-ghost min-h-11">重新載入</button>
        </div>
      )}

      {loading ? (
        <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
      ) : loadError && catalog.length === 0 ? null : catalog.length === 0 ? (
        <div className="shop-public-empty">
          <Package className="mx-auto" size={36} strokeWidth={1.2} aria-hidden="true" />
          <p>目前沒有可訂購的商品，請稍後再來看看。</p>
        </div>
      ) : selectedCategory && (
        <div>
          <nav className="shop-public-category-nav" aria-label="商品分類">
            {catalog.map((category) => {
              const isSelected = category.id === selectedCategory.id;
              const productCount = category.products.length
                + category.series.reduce((sum, series) => sum + series.products.length, 0);
              return (
                <button
                  key={category.id}
                  onClick={() => {
                    setSelectedCategoryId(category.id);
                    setSelectedSeriesId(null);
                  }}
                  aria-pressed={isSelected}
                  className="shop-public-category-tab">
                  {category.name}
                  <span className="shop-public-category-count">{productCount}</span>
                </button>
              );
            })}
          </nav>

          <section className="shop-public-catalog">
            <header className="shop-public-category-heading">
              <div>
                <h2>{selectedCategory.name}</h2>
                <p>{selectedCategory.series.length} 個系列 · {selectedCategory.products.length} 件單一商品</p>
              </div>
            </header>
            <div className="shop-public-series-filter" aria-label="篩選商品系列">
              <button
                onClick={() => setSelectedSeriesId(null)}
                aria-pressed={!selectedSeriesId}>
                全部商品
              </button>
              {selectedCategory.series.map((series) => {
                const isSelected = selectedSeriesId === series.id;
                return (
                  <button
                    key={series.id}
                    onClick={() => setSelectedSeriesId(series.id)}
                    aria-pressed={isSelected}>
                    {series.name} <span>({series.products.length})</span>
                  </button>
                );
              })}
            </div>
            {closeStatus[selectedCategory.id]?.is_closed && (
              <div className="shop-public-alert mt-6">
                <CircleAlert size={18} aria-hidden="true" />
                <p>
                  <strong>您的班級已結單</strong>
                  {closeStatus[selectedCategory.id].closed_at && (
                    <span className="ml-1 text-xs">
                      （{new Date(closeStatus[selectedCategory.id].closed_at!).toLocaleString("zh-TW")}）
                    </span>
                  )}
                  ，如需更改請聯繫班級幹部。
                </p>
              </div>
            )}
            <div className="shop-public-series-list">
              {!selectedSeriesId && selectedCategory.products.length > 0 && (
                <section className="shop-public-series">
                  <div className="shop-public-series-heading">
                    <div>
                      <h3>單一商品</h3>
                      <p>{selectedCategory.products.length} 件商品</p>
                    </div>
                    <span className="shop-public-series-rule" aria-hidden="true" />
                  </div>
                  <div className="shop-public-product-grid">
                    {selectedCategory.products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        classClosed={Boolean(closeStatus[selectedCategory.id]?.is_closed)}
                        onClick={() => {
                          setDirectOrderProductId(null);
                          setOpenProduct(product.id);
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}
              {visibleSeries.map((series) => (
                <section key={series.id} className="shop-public-series">
                  <div className="shop-public-series-heading">
                    {series.image_url && <Thumb url={series.image_url} alt="" size={42} />}
                    <div>
                      <h3>{series.name}</h3>
                      <p>{series.products.length} 件商品</p>
                    </div>
                    <span className="shop-public-series-rule" aria-hidden="true" />
                  </div>
                  {series.products.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--public-secondary)" }}>這個系列暫時沒有商品</p>
                  ) : (
                    <div className="shop-public-product-grid">
                      {series.products.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          classClosed={Boolean(closeStatus[selectedCategory.id]?.is_closed)}
                          onClick={() => {
                            setDirectOrderProductId(null);
                            setOpenProduct(product.id);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </section>
        </div>
      )}

      {openProduct && (
        <ProductModal
          productId={openProduct}
          classClosed={Boolean(closeStatus[selectedCategory?.id ?? ""]?.is_closed)}
          isLoggedIn={isLoggedIn}
          directPurchaseOnly={directOrderProductId === openProduct || selectedActivityProductCount === 1}
          onClose={closeProduct}
          onAdded={(goToCart) => {
            setOpenProduct(null);
            setDirectOrderProductId(null);
            loadCart();
            if (goToCart) {
              router.push("/shop/cart");
            } else {
              setCartButtonBump(true);
              window.setTimeout(() => setCartButtonBump(false), 700);
            }
          }}
        />
      )}
    </div>
  );
}
