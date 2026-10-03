"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Link from "next/link";
import { CircleAlert, CircleCheck, ClipboardList, Gift, Package } from "lucide-react";
import { authApi, classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type {
  CatalogCategoryOut,
  CatalogProductOut,
  CloseStatusItem,
  ProductOut,
  MyClassContext,
  OrderOut,
  ShopPromotionPreviewOut,
  ShopPromotionPublicOut,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePersistedState } from "@/hooks/usePersistedState";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";
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

function registrationVariantKey(options: readonly { option_id: string }[]) {
  return options.map((option) => option.option_id).sort().join(",");
}

function registrationLockMessage({
  registrationLocked,
  classClosed,
  deadlinePassed,
}: {
  registrationLocked: boolean;
  classClosed: boolean;
  deadlinePassed: boolean;
}) {
  if (registrationLocked) return "班級幹部已登記收款，商品登記已鎖定";
  if (classClosed) return "本班已結單，請聯繫班級幹部";
  if (deadlinePassed) return "商品登記已截止";
  return "登入後即可登記商品";
}

// ── 商品變體選購 Modal ────────────────────────────────────────────────────────

function ProductModal({
  productId,
  classClosed,
  isLoggedIn,
  authLoading,
  registrationLoadError,
  registration,
  registrationLocked,
  onClose,
  onRegistrationChange,
}: {
  productId: string;
  classClosed: boolean;
  isLoggedIn: boolean;
  authLoading: boolean;
  registrationLoadError: boolean;
  registration: OrderOut | null;
  registrationLocked: boolean;
  onClose: () => void;
  onRegistrationChange: (order: OrderOut | null) => void;
}) {
  const [product, setProduct] = useState<ProductOut | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(true);
  const [productLoadError, setProductLoadError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [registrationUpdateMessage, setRegistrationUpdateMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const registrationUpdateInFlightRef = useRef(false);
  const registrationItemsRef = useRef(registration?.items ?? []);
  const loadedProductId = product?.id ?? null;
  const registrationId = registration?.id ?? null;

  const loadProduct = useCallback(async () => {
    setProduct(null);
    setPicked({});
    setSelectedMediaIndex(null);
    setQty(1);
    setRegistrationUpdateMessage("");
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
    registrationItemsRef.current = registration?.items ?? [];
  }, [registration?.items]);

  useEffect(() => {
    if (!loadedProductId) return;
    const first = registrationItemsRef.current.find((item) => item.product_id === loadedProductId);
    const nextPicked = Object.fromEntries(
      (first?.selected_options ?? []).map((option) => [option.group_id, option.option_id]),
    );
    setPicked(nextPicked);
    setQty(first?.quantity ?? 1);
  }, [loadedProductId, registrationId]);

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
  const registeredItems = registration?.items.filter((item) => item.product_id === product?.id) ?? [];
  const registeredQuantity = registeredItems.reduce((total, item) => total + item.quantity, 0);
  const selectedOptionIds = Object.values(picked).sort();
  const selectedRegistrationQuantity = registeredItems
    .filter((item) => registrationVariantKey(item.selected_options) === selectedOptionIds.join(","))
    .reduce((total, item) => total + item.quantity, 0);
  const remainingForUser = product?.max_quantity_per_user == null
    ? null
    : product.remaining_quantity_for_user ?? product.max_quantity_per_user;
  const maxSelectableQuantity = product
    ? Math.max(
        0,
        Math.min(
          100,
          product.is_unlimited ? 100 : product.stock_quantity + registeredQuantity,
          remainingForUser == null ? 100 : remainingForUser + registeredQuantity,
        ),
      )
    : 0;
  const maxSelectedQuantity = Math.max(
    0,
    maxSelectableQuantity - (registeredQuantity - selectedRegistrationQuantity),
  );
  const deadlinePassed = Boolean(product?.sale_end && new Date(product.sale_end).getTime() <= Date.now());
  const available = Boolean(
    product
      && (product.status === "active" || registeredQuantity > 0)
      && (product.is_unlimited || product.stock_quantity > 0 || registeredQuantity > 0),
  );
  const canEdit = isLoggedIn
    && !authLoading
    && !registrationLoadError
    && !registrationLocked
    && !classClosed
    && !deadlinePassed;
  const canRegister = available && canEdit && maxSelectedQuantity > 0;
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

  const setVariantQuantity = async (optionIds: string[], quantity: number) => {
    if (!product) return;
    if (registrationUpdateInFlightRef.current) return;
    if (!canEdit) {
      toast.error(registrationLockMessage({
        registrationLocked,
        classClosed,
        deadlinePassed,
      }));
      return;
    }
    registrationUpdateInFlightRef.current = true;
    setLoading(true);
    setRegistrationUpdateMessage("正在更新登記數量…");
    try {
      const currentVariants = new Map<string, { option_ids: string[]; quantity: number }>();
      for (const item of registeredItems) {
        const option_ids = item.selected_options.map((option) => option.option_id).sort();
        const key = option_ids.join(",");
        currentVariants.set(key, {
          option_ids,
          quantity: (currentVariants.get(key)?.quantity ?? 0) + item.quantity,
        });
      }
      const key = [...optionIds].sort().join(",");
      const wasRegistered = (currentVariants.get(key)?.quantity ?? 0) > 0;
      currentVariants.delete(key);
      if (quantity > 0) currentVariants.set(key, { option_ids: [...optionIds].sort(), quantity });
      const updated = await shopApi.setCurrentRegistrationProduct(product.id, {
        variants: [...currentVariants.values()],
      });
      onRegistrationChange(updated?.status === "cancelled" ? null : updated);
      if (key === selectedOptionIds.join(",")) setQty(quantity > 0 ? quantity : 1);
      setRegistrationUpdateMessage(quantity > 0
        ? wasRegistered ? `已立即更新為 ${quantity} 件。` : `已登記 ${quantity} 件。`
        : "已從登記移除這個規格。");
    } catch (e) {
      setRegistrationUpdateMessage("更新失敗，登記數量維持原值。");
      toast.error(apiErrorMessage(e, "商品登記更新失敗"));
    } finally {
      registrationUpdateInFlightRef.current = false;
      setLoading(false);
    }
  };

  const changeSelectedQuantity = (quantity: number) => {
    if (selectedRegistrationQuantity > 0) {
      void setVariantQuantity(selectedOptionIds, quantity);
      return;
    }
    setQty(quantity);
    setRegistrationUpdateMessage("");
  };

  const submit = () => {
    if (!product) return;
    if (!allPicked) {
      toast.error("請選擇所有規格");
      return;
    }
    if (!canRegister || qty > maxSelectedQuantity) {
      toast.error("可登記數量已更新，請重新選擇");
      return;
    }
    void setVariantQuantity(selectedOptionIds, qty);
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
                              const nextPicked = { ...picked, [g.id]: o.id };
                              setPicked(nextPicked);
                              const nextKey = Object.values(nextPicked).sort().join(",");
                              const registered = registeredItems
                                .filter((item) => registrationVariantKey(item.selected_options) === nextKey)
                                .reduce((total, item) => total + item.quantity, 0);
                              setQty(registered || 1);
                              setRegistrationUpdateMessage("");
                            }}
                            disabled={authLoading || loading}
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
                {maxSelectedQuantity === 0 ? (
                  <p className="text-sm" style={{ color: "var(--public-secondary)" }}>
                    {registeredQuantity > 0 ? "目前已達可登記數量。" : "目前沒有可登記數量。"}
                  </p>
                ) : product.max_quantity_per_user === 1 ? (
                  <p className="text-sm" style={{ color: "var(--public-secondary)" }}>
                    每人限購 1 件{selectedRegistrationQuantity > 0 ? " · 已登記" : ""}
                  </p>
                ) : (
                  <div className="shop-product-quantity">
                    <button
                      type="button"
                      onClick={() => changeSelectedQuantity(Math.max(selectedRegistrationQuantity > 0 ? 0 : 1, qty - 1))}
                      disabled={qty <= (selectedRegistrationQuantity > 0 ? 0 : 1) || !canEdit || loading}
                      aria-label="減少數量">−</button>
                    <span>{qty}</span>
                    <button
                      type="button"
                      onClick={() => changeSelectedQuantity(Math.min(maxSelectedQuantity, qty + 1))}
                      disabled={qty >= maxSelectedQuantity || !canEdit || loading}
                      aria-label="增加數量">＋</button>
                  </div>
                )}
              </div>

              {registeredItems.length > 0 && (
                <div className="shop-product-dialog-section">
                  <label>已登記規格</label>
                  <div className="space-y-2">
                    {registeredItems.map((item) => {
                      const optionIds = item.selected_options.map((option) => option.option_id).sort();
                      const optionLabel = item.selected_options.length
                        ? item.selected_options.map((option) => `${option.group_name}：${option.value}`).join("、")
                        : "標準品項";
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left"
                            onClick={() => {
                              setPicked(Object.fromEntries(
                                item.selected_options.map((option) => [option.group_id, option.option_id]),
                              ));
                              setQty(item.quantity);
                              setSelectedMediaIndex(null);
                              setRegistrationUpdateMessage("");
                            }}>
                            {optionLabel}
                          </button>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void setVariantQuantity(optionIds, item.quantity - 1)}
                              disabled={!canEdit || loading}
                              aria-label={`減少${optionLabel}數量`}
                              className="btn btn-ghost h-11 w-11 p-0">−</button>
                            <span className="w-5 text-center tabular-nums">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => void setVariantQuantity(optionIds, item.quantity + 1)}
                              disabled={!canEdit || loading || registeredQuantity >= maxSelectableQuantity}
                              aria-label={`增加${optionLabel}數量`}
                              className="btn btn-ghost h-11 w-11 p-0">＋</button>
                            <button
                              type="button"
                              onClick={() => void setVariantQuantity(optionIds, 0)}
                              disabled={!canEdit || loading}
                              className="min-h-11 min-w-11 px-2 text-xs"
                              style={{ color: "var(--text-muted)" }}>移除</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedRegistrationQuantity > 0 || registrationUpdateMessage ? (
                <p className="shop-product-registration-status" role="status" aria-live="polite">
                  {registrationUpdateMessage || `已登記 ${selectedRegistrationQuantity} 件，調整數量會立即更新。`}
                </p>
              ) : null}

              {!isLoggedIn ? (
                <p className="shop-product-purchase-hint" role="status">
                  {authLoading ? "正在確認登入狀態…" : "登入後即可登記商品。"}
                </p>
              ) : registrationLoadError ? (
                <p className="shop-product-purchase-hint" role="alert">
                  目前無法讀取商品登記，請重新載入頁面後再修改。
                </p>
              ) : (registrationLocked || classClosed || deadlinePassed) ? (
                <p className="shop-product-purchase-hint" role="status">
                  {registrationLockMessage({ registrationLocked, classClosed, deadlinePassed })}
                </p>
              ) : null}
              <div className="shop-product-dialog-actions">
                {isLoggedIn && selectedRegistrationQuantity > 0 ? (
                  <div className="shop-product-registration-summary">
                    <strong>已登記 {selectedRegistrationQuantity} 件</strong>
                    <span>NT${(unitPrice * selectedRegistrationQuantity).toLocaleString()}</span>
                  </div>
                ) : isLoggedIn ? (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={loading || !canRegister || qty > maxSelectedQuantity}
                    className="shop-product-submit"
                    aria-busy={loading}>
                    {loading
                      ? "處理中…"
                      : `登記購買 · NT$${(unitPrice * qty).toLocaleString()}`}
                  </button>
                ) : (
                  <Link
                    href={`/login?next=${encodeURIComponent(`/shop?product=${productId}`)}`}
                    className="shop-product-submit">
                    登入後登記商品
                  </Link>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="shop-product-cancel">
                  {selectedRegistrationQuantity > 0 ? "完成" : "取消"}
                </button>
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
  registeredQuantity,
  onClick,
}: {
  product: CatalogProductOut;
  classClosed: boolean;
  registeredQuantity: number;
  onClick: () => void;
}) {
  const soldOut = product.status === "sold_out";
  const deadlinePassed = Boolean(product.sale_end && new Date(product.sale_end).getTime() <= Date.now());
  const locked = classClosed || deadlinePassed;
  const disabled = (soldOut || locked) && registeredQuantity === 0;
  const statusLabel = classClosed
    ? "本班已結單"
    : deadlinePassed
      ? "登記已截止"
      : registeredQuantity > 0
        ? `已登記 ${registeredQuantity} 件`
        : soldOut
          ? "已售完"
          : null;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="shop-public-product-card group"
      style={{
        opacity: disabled ? 0.6 : 1,
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
  const catalogCacheKey = "shop/catalog/all:v2";

  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>(() => cacheGet<CatalogCategoryOut[]>(catalogCacheKey) ?? []);
  const [loading, setLoading] = useState(!cacheHas(catalogCacheKey));
  const [loadError, setLoadError] = useState(false);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [registrationLoadError, setRegistrationLoadError] = useState(false);
  const [registration, setRegistration] = useState<OrderOut | null>(null);
  const [availablePromotions, setAvailablePromotions] = useState<ShopPromotionPublicOut[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [promotionPreview, setPromotionPreview] = useState<ShopPromotionPreviewOut | null>(null);
  const [promotionBusy, setPromotionBusy] = useState(false);
  const [promotionFeedback, setPromotionFeedback] = useState("");
  const [claimedPromotionIds, setClaimedPromotionIds] = useState<Set<string>>(() => new Set());
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [myClass, setMyClass] = useState<MyClassContext | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = usePersistedState<string | null>("hcca:pref:shop:category:v1", null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const closeProduct = useCallback(() => {
    setOpenProduct(null);
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

  useEffect(() => {
    loadCatalog();
    void shopApi.listAvailablePromotions()
      .then(setAvailablePromotions)
      .catch(() => setAvailablePromotions([]));
    void authApi.me()
      .then(async () => {
        setIsLoggedIn(true);
        try {
          setRegistration(await shopApi.getCurrentRegistration());
        } catch (error) {
          setRegistrationLoadError(true);
          toast.error(apiErrorMessage(error, "無法載入商品登記"));
        }
      })
      .catch(() => {
        setIsLoggedIn(false);
        setRegistration(null);
      })
      .finally(() => setAuthLoading(false));
  }, [loadCatalog]);

  useEffect(() => {
    if (!isLoggedIn || authLoading || !registration) {
      setPromotionPreview(null);
      return;
    }
    void shopApi.previewCurrentPromotion(registration.promotion_code ?? null)
      .then(setPromotionPreview)
      .catch(() => setPromotionPreview(null));
  }, [isLoggedIn, authLoading, registration]);

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
    setOpenProduct(productId);
  }, [catalog, setSelectedCategoryId]);

  const selectedCategory =
    catalog.find((category) => category.id === selectedCategoryId) ?? catalog[0] ?? null;

  const registeredCount = registration?.items.reduce((count, item) => count + item.quantity, 0) ?? 0;
  const registeredByProduct = new Map<string, number>();
  for (const item of registration?.items ?? []) {
    registeredByProduct.set(
      item.product_id,
      (registeredByProduct.get(item.product_id) ?? 0) + item.quantity,
    );
  }
  const registrationLocked = Boolean(
    registration && (registration.is_paid || registration.is_class_collected),
  );

  const inspectAndApplyPromotion = async (code: string | null) => {
    if (!isLoggedIn || authLoading) {
      setPromotionFeedback("登入後登記商品即可使用這項優惠。");
      return;
    }
    if (!registration) {
      setPromotionFeedback(code
        ? "優惠碼已帶入；登記符合條件的商品後即可檢查並套用。"
        : "先登記商品；符合條件時系統會自動套用優惠。 ");
      return;
    }
    if (registrationLocked) {
      setPromotionFeedback("目前登記已鎖定，如需更改優惠請聯繫班級幹部。");
      return;
    }
    setPromotionBusy(true);
    setPromotionFeedback("");
    try {
      const preview = await shopApi.previewCurrentPromotion(code);
      setPromotionPreview(preview);
      if (!preview.eligible) {
        setPromotionFeedback(preview.reason ?? "目前尚未符合優惠條件。");
        return;
      }
      const updated = await shopApi.applyCurrentPromotion(code);
      setRegistration(updated);
      setPromotionFeedback(preview.reason ?? "優惠已套用。");
    } catch (error) {
      const message = apiErrorMessage(error, "優惠套用失敗");
      setPromotionFeedback(message);
      toast.error(message);
    } finally {
      setPromotionBusy(false);
    }
  };

  const handleRegistrationChange = async (order: OrderOut | null) => {
    setRegistration(order);
    const pendingCode = couponCode.trim();
    if (!order || !pendingCode || order.promotion_code?.toUpperCase() === pendingCode.toUpperCase()) {
      return;
    }
    try {
      const preview = await shopApi.previewCurrentPromotion(pendingCode);
      setPromotionPreview(preview);
      if (preview.eligible) {
        const updated = await shopApi.applyCurrentPromotion(pendingCode);
        setRegistration(updated);
        setPromotionFeedback(preview.reason ?? "優惠已套用。");
      } else {
        setPromotionFeedback(preview.reason ?? "商品已更新，優惠仍未達使用條件。");
      }
    } catch (error) {
      setPromotionFeedback(apiErrorMessage(error, "優惠檢查失敗"));
    }
  };

  const claimPromotion = (promotion: ShopPromotionPublicOut) => {
    const code = promotion.code ?? "";
    setCouponCode(code);
    if (promotion.code) {
      setClaimedPromotionIds((current) => new Set(current).add(promotion.id));
      setPromotionFeedback(`已領取「${promotion.name}」，優惠碼 ${promotion.code} 已帶入。`);
    } else {
      setPromotionFeedback(`「${promotion.name}」符合條件時會自動折抵；可先查看目前進度。`);
    }
      void inspectAndApplyPromotion(promotion.code ?? null);
  };

  const openPromotionProduct = (productId: string) => {
    const category = catalog.find((item) =>
      item.products.some((product) => product.id === productId)
      || item.series.some((series) => series.products.some((product) => product.id === productId)),
    );
    if (!category) return;
    const series = category.series.find((item) => item.products.some((product) => product.id === productId));
    setSelectedCategoryId(category.id);
    setSelectedSeriesId(series?.id ?? null);
    setOpenProduct(productId);
  };

  const visibleSeries = selectedCategory?.series.filter(
    (series) => !selectedSeriesId || series.id === selectedSeriesId,
  ) ?? [];

  return (
    <div className="shop-public-page">
      <header className="shop-public-hero">
        <div>
          <h1>商品預購</h1>
        </div>
        <div className="shop-public-hero-actions">
          <Link
            href="/shop/orders"
            className="shop-public-order-link">
            <ClipboardList size={16} aria-hidden="true" />
            我的登記{registeredCount > 0 ? `（${registeredCount} 件）` : ""}
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
            {isLoggedIn && <ClassCorrectionRequest currentClass={myClass} />}
          </div>
        </section>
      )}

      {availablePromotions.length > 0 && (
        <section className="shop-public-promotions" aria-labelledby="shop-promotions-title">
          <div className="shop-public-promotions-heading">
            <div>
              <p className="shop-public-eyebrow"><Gift size={15} aria-hidden="true" /> 優惠專區</p>
              <h2 id="shop-promotions-title">Nothing beats HCHS Student Association merch!</h2>
            </div>
            <label className="shop-public-coupon-entry">
              <span>優惠碼</span>
              <input
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                placeholder="輸入或領取優惠碼"
                autoCapitalize="characters"
                aria-label="優惠碼"
              />
              <button
                type="button"
                onClick={() => void inspectAndApplyPromotion(couponCode.trim() || null)}
                disabled={promotionBusy || !isLoggedIn}
              >
                {promotionBusy ? "檢查中…" : couponCode.trim() ? "檢查並套用" : "查看自動優惠"}
              </button>
            </label>
          </div>
          {promotionFeedback && <p className="shop-public-promotion-feedback" role="status" aria-live="polite">{promotionFeedback}</p>}
          {promotionPreview?.reason && (
            <p className="shop-public-promotion-preview" role="status">
              {promotionPreview.promotion_name && <strong>{promotionPreview.promotion_name} · </strong>}
              {promotionPreview.reason}
            </p>
          )}
          <div className="shop-public-promotion-grid">
            {availablePromotions.map((promotion) => {
              const targetProducts = promotion.target_products ?? [];
              const targetIds = new Set(targetProducts.map((product) => product.id));
              const registeredProducts = new Set((registration?.items ?? []).map((item) => item.product_id));
              const missingProducts = targetProducts.filter((product) => !registeredProducts.has(product.id));
              const matchingItems = (registration?.items ?? []).filter((item) =>
                targetIds.size === 0 || targetIds.has(item.product_id),
              );
              const matchingQuantity = matchingItems.reduce((sum, item) => sum + item.quantity, 0);
              const matchingSubtotal = matchingItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
              const quantityShortfall = Math.max(0, promotion.min_quantity - matchingQuantity);
              const spendShortfall = Math.max(0, promotion.min_order_price - (registration?.subtotal_price ?? 0));
              const isApplied = registration?.promotion_id === promotion.id;
              const estimatedBase = targetIds.size > 0 ? matchingSubtotal : registration?.subtotal_price ?? 0;
              const estimatedDiscount = promotion.discount_type === "percentage"
                ? Math.floor(estimatedBase * promotion.discount_value / 100)
                : Math.min(estimatedBase, promotion.discount_value);
              const progressParts = [
                promotion.min_order_price > 0
                  ? (registration?.subtotal_price ?? 0) / promotion.min_order_price
                  : 1,
                promotion.min_quantity > 1 ? matchingQuantity / promotion.min_quantity : 1,
              ];
              const progressValue = Math.min(100, Math.round(Math.min(...progressParts) * 100));
              const requirementsMet = missingProducts.length === 0 && quantityShortfall === 0 && spendShortfall === 0;
              const progressLabel = !isLoggedIn
                ? "登入並登記商品後即可查看。"
                : missingProducts.length > 0
                  ? `還需登記：${missingProducts.map((product) => product.name).join("、")}`
                  : quantityShortfall > 0
                    ? `再登記 ${quantityShortfall} 件即可達到件數門檻。`
                    : spendShortfall > 0
                      ? `目前 NT$${registration?.subtotal_price.toLocaleString() ?? 0}，再登記 NT$${spendShortfall.toLocaleString()} 即達門檻。`
                      : isApplied
                        ? `已套用，折抵 NT$${registration?.discount_amount.toLocaleString() ?? 0}。`
                        : requirementsMet && registration
                          ? `已達優惠條件，可折抵 NT$${estimatedDiscount.toLocaleString()}。`
                          : "登記商品後即可查看進度。";
              const actionLabel = promotion.code
                ? claimedPromotionIds.has(promotion.id) ? "已領取優惠券" : "領取優惠券"
                : isApplied ? "已自動套用" : "查看優惠進度";
              return (
                <article className="shop-public-promotion-card" key={promotion.id}>
                  <div className="shop-public-promotion-card-top">
                    <span className="shop-public-promotion-icon"><Gift size={17} aria-hidden="true" /></span>
                    <span>{promotion.code ? "優惠券" : "優惠自動套用"}</span>
                    {isApplied && <span className="shop-public-promotion-applied"><CircleCheck size={14} aria-hidden="true" />已套用</span>}
                  </div>
                  <h3>{promotion.name}</h3>
                  <p className="shop-public-promotion-value">
                    {promotion.discount_type === "percentage"
                      ? `${promotion.discount_value}% 折扣`
                      : `折抵 NT$${promotion.discount_value.toLocaleString()}`}
                  </p>
                  {promotion.code && <p className="shop-public-promotion-code">{promotion.code}</p>}
                  <div className="shop-public-promotion-conditions">
                    {promotion.min_order_price > 0 && <span>消費滿 NT$${promotion.min_order_price.toLocaleString()}</span>}
                    {promotion.min_quantity > 1 && <span>滿 {promotion.min_quantity} 件</span>}
                    {targetProducts.length > 0 && (
                      <span>折扣計指定品項：{targetProducts.map((product) => product.name).join(" + ")}</span>
                    )}
                    {promotion.min_order_price === 0 && promotion.min_quantity <= 1 && targetProducts.length === 0 && <span>無最低消費門檻</span>}
                  </div>
                  {promotion.min_order_price > 0 || promotion.min_quantity > 1 ? (
                    <div className="shop-public-promotion-meter">
                      <div role="meter" aria-label={`${promotion.name} 優惠進度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}>
                        <span style={{ width: `${progressValue}%` }} />
                      </div>
                      <p>{progressLabel}</p>
                    </div>
                  ) : <p className="shop-public-promotion-progress">{progressLabel}</p>}
                  {promotion.description && <p className="shop-public-promotion-description">{promotion.description}</p>}
                  {promotion.ends_at && (
                    <p className="shop-public-promotion-description">
                      優惠至 {new Date(promotion.ends_at).toLocaleString("zh-TW")}
                    </p>
                  )}
                  <div className="shop-public-promotion-actions">
                    <button
                      type="button"
                      onClick={() => claimPromotion(promotion)}
                      disabled={promotionBusy || isApplied}
                    >
                      {actionLabel}
                    </button>
                    {missingProducts[0] && (
                      <button type="button" className="shop-public-promotion-browse" onClick={() => openPromotionProduct(missingProducts[0].id)}>
                        選購指定商品
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
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
              <h2>{selectedCategory.name}</h2>
            </header>
            {selectedCategory.series.length > 0 && (
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
            )}
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
                  <div className="shop-public-series-heading shop-public-series-heading--single">
                    <div>
                      <h3>單一商品</h3>
                    </div>
                  </div>
                  <div className="shop-public-product-grid">
                    {selectedCategory.products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        classClosed={Boolean(closeStatus[selectedCategory.id]?.is_closed)}
                        registeredQuantity={registeredByProduct.get(product.id) ?? 0}
                        onClick={() => setOpenProduct(product.id)}
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
                          registeredQuantity={registeredByProduct.get(product.id) ?? 0}
                          onClick={() => setOpenProduct(product.id)}
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
          authLoading={authLoading}
          registrationLoadError={registrationLoadError}
          registration={registration}
          registrationLocked={registrationLocked}
          onClose={closeProduct}
          onRegistrationChange={handleRegistrationChange}
        />
      )}
    </div>
  );
}
