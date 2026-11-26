import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Package } from "lucide-react";

import ProductSizeChart from "@/components/shop/ProductSizeChart";
import OptionPrice from "@/components/shop/OptionPrice";
import ProductDetailOffers from "@/components/shop/ProductDetailOffers";
import ProductThumbnail from "@/components/shop/ProductThumbnail";
import ShopImage from "@/components/shop/ShopImage";
import ShopPrice from "@/components/shop/ShopPrice";
import OrderItemGiftBreakdown from "@/components/shop/OrderItemGiftBreakdown";
import { useShopRegistration } from "@/hooks/useShopRegistration";
import { apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import { productDeadline } from "@/lib/shop-deadlines";
import { productGallery } from "@/lib/shop-product-media";
import { productOfferPrice } from "@/lib/shop-promotion-price";
import { referenceDelta, referencePrice } from "@/lib/shop-reference-price";
import { registrationLockMessage, registrationVariantKey } from "@/lib/shop-registration";
import type { CloseStatusItem, OrderOut, ProductOut, ShopPromotionPublicOut } from "@/lib/types";
import { OrderClosureNotice, resolveOrderClosureState } from "@/components/shop/ShopOrderClosure";

export function Thumb({ url, alt, size = 64 }: { url: string | null; alt: string; size?: number }) {
  return <ProductThumbnail url={url} alt={alt} size={size} />;
}


// ── 商品變體選購 Modal ────────────────────────────────────────────────────────

export function ProductModal({
  productId,
  getProduct,
  saveVariant,
  closeStatus,
  categoryClosedAt,
  isLoggedIn,
  authLoading,
  classStatusLoading,
  registrationLoadError,
  registration,
  registrationLocked,
  authorizationRequired = false,
  editingDescription,
  productHref,
  onClose,
  onProductAdded,
  onRequestDelegation,
  adjustingClassMember,
  lockedVariantQuantities,
  promotions,
  categoryId,
  bundleStep,
  bundleAddOn,
}: {
  productId: string;
  getProduct: (id: string) => Promise<ProductOut>;
  saveVariant: ReturnType<typeof useShopRegistration>["saveVariant"];
  closeStatus: CloseStatusItem | undefined;
  categoryClosedAt: string | null;
  isLoggedIn: boolean;
  authLoading: boolean;
  classStatusLoading: boolean;
  registrationLoadError: boolean;
  registration: OrderOut | null;
  registrationLocked: boolean;
  authorizationRequired?: boolean;
  editingDescription?: string;
  productHref: string | null;
  onClose: () => void;
  onProductAdded: () => void;
  onRequestDelegation: () => void;
  adjustingClassMember: boolean;
  lockedVariantQuantities: Map<string, number>;
  promotions: ShopPromotionPublicOut[];
  categoryId: string | null;
  bundleStep?: { name: string; position: number; total: number; nextLabel: string; onContinue: () => void };
  bundleAddOn?: (disabled: boolean) => React.ReactNode;
}) {
  const [product, setProduct] = useState<ProductOut | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [failedMediaUrl, setFailedMediaUrl] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [editingVariant, setEditingVariant] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(true);
  const [productLoadError, setProductLoadError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [registrationUpdateMessage, setRegistrationUpdateMessage] = useState("");
  const [registrationUpdateError, setRegistrationUpdateError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mediaSwipeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const registrationUpdateInFlightRef = useRef(false);
  const variantSelectionTouchedRef = useRef(false);
  const activeProductRef = useRef<string | null>(productId);
  const registrationItemsRef = useRef(registration?.items ?? []);
  const loadedProductId = product?.id ?? null;
  const registrationId = registration?.id ?? null;

  useEffect(() => {
    const gallery = galleryRef.current;
    const selected = gallery?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!gallery || !selected) return;
    // 只移動縮圖列，避免 scrollIntoView 連帶捲動商品視窗而裁切標題。
    const start = selected.getBoundingClientRect().left - gallery.getBoundingClientRect().left
      + gallery.scrollLeft;
    if (start < gallery.scrollLeft) gallery.scrollLeft = start;
    else if (start + selected.offsetWidth > gallery.scrollLeft + gallery.clientWidth) {
      gallery.scrollLeft = start + selected.offsetWidth - gallery.clientWidth;
    }
  }, [selectedMediaIndex]);

  const loadProduct = useCallback(async () => {
    setProduct(null);
    setPicked({});
    variantSelectionTouchedRef.current = false;
    setSelectedMediaIndex(null);
    setQty(1);
    setEditingVariant(null);
    setRegistrationUpdateMessage("");
    setRegistrationUpdateError(false);
    setProductLoading(true);
    setProductLoadError(false);
    try {
      const loaded = await getProduct(productId);
      if (activeProductRef.current === productId) setProduct(loaded);
    } catch {
      if (activeProductRef.current === productId) setProductLoadError(true);
    } finally {
      if (activeProductRef.current === productId) setProductLoading(false);
    }
  }, [productId, getProduct]);

  useEffect(() => {
    activeProductRef.current = productId;
    return () => { activeProductRef.current = null; };
  }, [productId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  useEffect(() => {
    registrationItemsRef.current = registration?.items ?? [];
  }, [registration?.items]);

  useEffect(() => {
    if (registrationUpdateInFlightRef.current || editingVariant !== null) return;
    const signature = Object.values(picked).sort().join(",");
    const quantity = (registration?.items ?? [])
      .filter((item) => item.product_id === loadedProductId
        && registrationVariantKey(item.selected_options) === signature)
      .reduce((total, item) => total + item.quantity, 0);
    if (quantity > 0) setQty(quantity);
  }, [registration?.items, loadedProductId, picked, editingVariant]);

  useEffect(() => {
    if (!loadedProductId || variantSelectionTouchedRef.current) return;
    const first = registrationItemsRef.current.find((item) => item.product_id === loadedProductId);
    const nextPicked = Object.fromEntries(
      (first?.selected_options ?? []).map((option) => [option.group_id, option.option_id]),
    );
    setPicked(nextPicked);
    const firstVariantKey = registrationVariantKey(first?.selected_options ?? []);
    const firstVariantQuantity = registrationItemsRef.current
      .filter((item) => item.product_id === loadedProductId
        && registrationVariantKey(item.selected_options) === firstVariantKey)
      .reduce((total, item) => total + item.quantity, 0);
    setQty(firstVariantQuantity || 1);
  }, [loadedProductId, registrationId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const previousFocus = document.activeElement;
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
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), summary",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [onClose, productId, mounted]);

  if (!mounted) return null;

  const variantGroups = product?.variant_groups ?? [];
  const media = product ? productGallery(product) : [];
  const delta = variantGroups.reduce((sum, g) => {
    const opt = (g.options ?? []).find((o) => o.id === picked[g.id]);
    return sum + (opt?.price_delta ?? 0);
  }, 0);
  const unitPrice = (product?.price ?? 0) + delta;
  const originalUnitPrice = (product ? referencePrice(product) : 0) + variantGroups.reduce((sum, group) => {
    const option = group.options.find((row) => row.id === picked[group.id]);
    return sum + (option ? referenceDelta(option) : 0);
  }, 0);
  const offerPrice = product ? productOfferPrice(product, promotions, registration, delta, 1, categoryId) : unitPrice;
  const offerTotal = product ? productOfferPrice(product, promotions, registration, delta, qty, categoryId) : unitPrice * qty;
  const allPicked = variantGroups.every((g) => picked[g.id]);
  const registeredItems = registration?.items.filter((item) => item.product_id === product?.id) ?? [];
  const selectVariantOption = (groupId: string, optionId: string) => {
    const option = variantGroups.find((group) => group.id === groupId)?.options.find((item) => item.id === optionId);
    if (!option) return;
    variantSelectionTouchedRef.current = true;
    if (option.image_url) {
      setSelectedMediaIndex(media.findIndex((item) => item.image_url === option.image_url));
    }
    const nextPicked = { ...picked, [groupId]: optionId };
    setPicked(nextPicked);
    const nextKey = Object.values(nextPicked).sort().join(",");
    const registered = registeredItems
      .filter((item) => registrationVariantKey(item.selected_options) === nextKey)
      .reduce((total, item) => total + item.quantity, 0);
    if (editingVariant === null) setQty(registered || 1);
    setRegistrationUpdateMessage("");
  };
  const registeredQuantity = registeredItems.reduce((total, item) => total + item.quantity, 0);
  const selectedOptionIds = Object.values(picked).sort();
  const selectedRegistrationQuantity = registeredItems
    .filter((item) => registrationVariantKey(item.selected_options) === selectedOptionIds.join(","))
    .reduce((total, item) => total + item.quantity, 0);
  const editingQuantity = registeredItems.filter((item) =>
    registrationVariantKey(item.selected_options) === editingVariant)
    .reduce((total, item) => total + item.quantity, 0);
  const registeredVariants = new Map<string, { item: typeof registeredItems[number]; quantity: number }>();
  for (const item of registeredItems) {
    const key = registrationVariantKey(item.selected_options);
    registeredVariants.set(key, { item, quantity: (registeredVariants.get(key)?.quantity ?? 0) + item.quantity });
  }
  const lockedSelectedQuantity = lockedVariantQuantities.get(selectedOptionIds.join(",")) ?? 0;
  const singlePurchase = product?.max_quantity_per_user === 1
    || (product?.purchase_allowed === false && registeredQuantity === 1);
  const replacingVariant = singlePurchase && registeredQuantity === 1
    && selectedRegistrationQuantity === 0
    && ![...lockedVariantQuantities.values()].some((quantity) => quantity > 0);
  const minimumSelectedQuantity = editingVariant !== null ? 1
    : Math.max(lockedSelectedQuantity, selectedRegistrationQuantity > 0 ? 0 : 1);
  const remainingForUser = product?.max_quantity_per_user == null
    ? null
    : adjustingClassMember
      ? Math.max(0, product.max_quantity_per_user - registeredQuantity)
      : product.remaining_quantity_for_user ?? product.max_quantity_per_user;
  const maxSelectableQuantity = product
    ? Math.max(
        0,
        Math.min(
          100,
          product.purchase_allowed === false ? registeredQuantity : product.is_unlimited ? 100 : product.stock_quantity + registeredQuantity,
          remainingForUser == null ? 100 : remainingForUser + registeredQuantity,
        ),
      )
    : 0;
  const maxSelectedQuantity = Math.max(
    0,
    Math.min(singlePurchase ? 1 : 100, maxSelectableQuantity)
      - (editingVariant !== null ? registeredQuantity - editingQuantity
        : replacingVariant ? 0 : registeredQuantity - selectedRegistrationQuantity),
  );
  const deadline = product ? productDeadline(product) : null;
  const testing = product?.status === "testing";
  const productCloseStatus = testing && !closeStatus?.is_global ? undefined : closeStatus;
  const closure = resolveOrderClosureState(productCloseStatus, categoryClosedAt);
  const deadlinePassed = !testing && (closure.deadlinePassed
    || Boolean(deadline && new Date(deadline).getTime() <= Date.now()));
  const councilClosed = closure.councilClosed;
  const classPaid = closure.classPaid;
  const orderClosed = closure.isClosed || deadlinePassed;
  const available = Boolean(
    product
      && (product.status === "active" || testing || registeredQuantity > 0)
      && (product.is_unlimited || product.stock_quantity > 0 || registeredQuantity > 0),
  );
  const canEdit = isLoggedIn
    && !authorizationRequired
    && !authLoading
    && (testing || !classStatusLoading)
    && !registrationLoadError
    && !registrationLocked
    && (testing || !orderClosed)
    && !deadlinePassed;
  const canRegister = available && canEdit && maxSelectedQuantity > 0;
  const variantImage = variantGroups.reduce<string | null>((current, group) => {
    const option = (group.options ?? []).find((o) => o.id === picked[group.id]);
    return option?.image_url || current;
  }, null);
  const selectedMedia = selectedMediaIndex === null ? null : media[selectedMediaIndex] ?? null;
  const displayMedia = selectedMedia ?? media.find((item) => item.image_url === variantImage) ?? media[0] ?? null;
  const displayLabel = displayMedia?.label ?? "商品照片";
  const displayMediaIndex = media.findIndex((item) => item.image_url === displayMedia?.image_url);

  const startMediaSwipe = (event: React.PointerEvent<HTMLImageElement>) => {
    if (media.length < 2 || (event.pointerType === "mouse" && event.button !== 0)) return;
    mediaSwipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishMediaSwipe = (event: React.PointerEvent<HTMLImageElement>) => {
    const start = mediaSwipeRef.current;
    mediaSwipeRef.current = null;
    if (!start || start.pointerId !== event.pointerId || media.length < 2) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    const currentIndex = selectedMediaIndex ?? media.findIndex(
      (item) => item.image_url === displayMedia?.image_url,
    );
    if (currentIndex < 0) {
      if (deltaX < 0) setSelectedMediaIndex(0);
      return;
    }

    const nextIndex = Math.max(0, Math.min(
      media.length - 1,
      currentIndex + (deltaX < 0 ? 1 : -1),
    ));
    if (nextIndex !== currentIndex) setSelectedMediaIndex(nextIndex);
  };

  const cancelMediaSwipe = (event: React.PointerEvent<HTMLImageElement>) => {
    if (mediaSwipeRef.current?.pointerId === event.pointerId) mediaSwipeRef.current = null;
  };

  const setVariantQuantity = async (optionIds: string[], quantity: number) => {
    if (!product || registrationUpdateInFlightRef.current) return false;
    if (!canEdit) {
      toast.error(registrationLockMessage({
        registrationLocked,
        classClosed: classPaid,
        councilClosed,
        deadlinePassed,
      }));
      return false;
    }
    registrationUpdateInFlightRef.current = true;
    setLoading(true);
    setRegistrationUpdateError(false);
    setRegistrationUpdateMessage("正在更新登記數量…");
    try {
      const key = [...optionIds].sort().join(",");
      const wasRegistered = registeredItems.some((item) =>
        registrationVariantKey(item.selected_options) === key && item.quantity > 0);
      const saved = await saveVariant(product.id, optionIds, quantity,
        editingVariant ?? (replacingVariant && quantity > 0));
      if (activeProductRef.current !== product.id) return false;
      if (!saved) {
        setRegistrationUpdateError(true);
        setRegistrationUpdateMessage("尚未確認登記結果，請先重新載入頁面並查看我的預購。");
        return false;
      }
      if (saved.added && editingVariant === null) onProductAdded();
      const wasEditing = editingVariant !== null;
      setEditingVariant(null);
      if (key === selectedOptionIds.join(",")) setQty(quantity > 0 ? quantity : 1);
      setRegistrationUpdateMessage(wasEditing ? "已儲存尺寸／規格與數量，其他登記已保留。" : quantity > 0
        ? wasRegistered ? `已更新為 ${quantity} 件。` : `已登記 ${quantity} 件。`
        : "已從登記移除這個規格。");
      return true;
    } catch (e) {
      const message = apiErrorMessage(e, "商品登記更新失敗，請稍後再試。");
      setRegistrationUpdateError(true);
      setRegistrationUpdateMessage(message);
      toast.error(message);
      return false;
    } finally {
      registrationUpdateInFlightRef.current = false;
      setLoading(false);
    }
  };

  const changeSelectedQuantity = (quantity: number) => {
    if (editingVariant === null && (selectedRegistrationQuantity > 0 || lockedSelectedQuantity > 0)) {
      void setVariantQuantity(selectedOptionIds, quantity);
      return;
    }
    setQty(quantity);
    setRegistrationUpdateMessage("");
  };

  const submit = async () => {
    if (!product) return;
    if (!allPicked) {
      toast.error("請選擇所有規格");
      return;
    }
    if (!canRegister || qty > maxSelectedQuantity) {
      toast.error("可登記數量已更新，請重新選擇");
      return;
    }
    const saved = await setVariantQuantity(selectedOptionIds, qty);
    if (saved && activeProductRef.current === productId) bundleStep?.onContinue();
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
        className={`shop-product-dialog min-w-0 animate-scale-in${orderClosed ? " shop-product-dialog--closed" : ""}`}
        data-order-closed={orderClosed || undefined}>
        <div className="shop-product-dialog-media">
          <div className="shop-product-dialog-stage">
            {product && displayMedia ? (
              failedMediaUrl === displayMedia.image_url ? (
                <div className="shop-product-dialog-placeholder" role="status">
                  <Package size={36} strokeWidth={1.2} aria-hidden="true" />
                  <p>圖片暫時無法顯示</p>
                  <button type="button" className="shop-product-retry" onClick={() => setFailedMediaUrl(null)}>重新載入圖片</button>
                </div>
              ) : (
                <ShopImage
                  key={displayMedia.image_url}
                  data-product-flight-source
                  src={uploadUrl(displayMedia.image_url)}
                  alt={`${product.name}・${displayLabel}`}
                  fill
                  sizes="(max-width: 767px) 100vw, 50vw"
                  loading="eager"
                  draggable={false}
                  onError={() => setFailedMediaUrl(displayMedia.image_url)}
                  onPointerDown={startMediaSwipe}
                  onPointerUp={finishMediaSwipe}
                  onPointerCancel={cancelMediaSwipe}
                />
              )
            ) : (
              <div className="shop-product-dialog-placeholder" data-product-flight-source>
                <Package size={48} strokeWidth={1.2} aria-hidden="true" />
                {product && <p>此商品尚未提供圖片</p>}
              </div>
            )}
            {product && media.length > 1 && <>
              <button type="button" className="shop-product-gallery-nav shop-product-gallery-nav--previous"
                aria-label="上一張商品圖片" disabled={displayMediaIndex <= 0}
                onClick={() => setSelectedMediaIndex(displayMediaIndex - 1)}>
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <button type="button" className="shop-product-gallery-nav shop-product-gallery-nav--next"
                aria-label="下一張商品圖片" disabled={displayMediaIndex >= media.length - 1}
                onClick={() => setSelectedMediaIndex(displayMediaIndex + 1)}>
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </>}
          </div>
          {product && displayMedia && (displayMedia.caption || media.length > 1) && <div className="shop-product-dialog-caption" role="status" aria-live="polite" aria-atomic="true">
            {displayMedia.caption && <span title={displayMedia.caption}>{displayMedia.caption}</span>}
            {media.length > 1 && <span className="shop-product-dialog-counter" aria-label={`第 ${displayMediaIndex + 1} 張，共 ${media.length} 張`}>
              {displayMediaIndex + 1} / {media.length}
            </span>}
          </div>}
          {product && media.length > 1 && (
            <div ref={galleryRef} className="shop-product-dialog-gallery" role="group" aria-label="商品圖片"
              onKeyDown={(event) => {
                let index = displayMediaIndex;
                if (event.key === "ArrowLeft") index -= 1;
                else if (event.key === "ArrowRight") index += 1;
                else if (event.key === "Home") index = 0;
                else if (event.key === "End") index = media.length - 1;
                else return;
                event.preventDefault();
                index = Math.max(0, Math.min(media.length - 1, index));
                setSelectedMediaIndex(index);
                galleryRef.current?.querySelectorAll("button")[index]?.focus({ preventScroll: true });
              }}>
              {media.map((item, index) => {
                const selected = item.image_url === displayMedia?.image_url;
                return (
                  <button
                    key={`${item.image_url}-${index}`}
                    type="button"
                    onClick={() => setSelectedMediaIndex(index)}
                    aria-label={`顯示${item.label}`}
                    aria-pressed={selected}
                    title={item.label}
                    className="shop-product-dialog-gallery-item">
                    <ShopImage src={uploadUrl(item.thumbnail_url)} alt="" width={64} height={64} sizes="64px" loading="lazy" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button ref={closeButtonRef} onClick={onClose} className="shop-product-dialog-close topbar-icon-btn" aria-label="關閉">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="shop-product-dialog-content">
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
              <div className="shop-product-dialog-scroll">
                <OrderClosureNotice
                  status={productCloseStatus}
                  categoryClosedAt={categoryClosedAt}
                />
                {bundleStep && <div className="shop-product-bundle-progress" role="status">
                  <strong>{bundleStep.name}</strong>
                  <span>第 {bundleStep.position} / {bundleStep.total} 項</span>
                </div>}
                <div className="shop-product-dialog-heading">
                  <h3 id="product-modal-title">{product.name}</h3>
                  <ShopPrice original={originalUnitPrice} current={offerPrice} />
                  {bundleStep && <p className="shop-product-purchase-hint">正在選購「{bundleStep.name}」，每項各一件；選齊後享套組價。</p>}
                  {editingDescription && <p className="shop-product-purchase-hint">{editingDescription}</p>}
                  {product.description && <details className="shop-product-description">
                    <summary>商品說明<ChevronDown size={16} aria-hidden="true" /></summary>
                    <p className="whitespace-pre-line">{product.description}</p>
                  </details>}
                  {!product.is_unlimited && product.status === "active" && (
                    <p className="shop-product-dialog-stock">剩餘 {product.stock_quantity} 件</p>
                  )}
                  {product.max_quantity_per_user != null && (
                    <p className="shop-product-dialog-stock">
                      每人限購 {product.max_quantity_per_user} 件
                      {remainingForUser != null && ` · ${adjustingClassMember ? "此同學" : "此帳號"}尚可選 ${remainingForUser} 件`}
                    </p>
                  )}
                  {lockedSelectedQuantity > 0 && (
                    <>
                      <p className="shop-product-purchase-hint">
                        已收款或鎖定 {lockedSelectedQuantity} 件，調整時會保留這個數量。
                      </p>
                      {!adjustingClassMember && <p className="shop-product-purchase-hint">可繼續加購，加購後由班代補收差額。</p>}
                    </>
                  )}
                </div>

                {!bundleStep && registeredVariants.size > 0 && <section className="shop-registered-variants" aria-label="已登記的規格">
                  <h4>已登記的規格</h4>
                  <ul>{[...registeredVariants].map(([key, { item, quantity }]) => <li key={key}>
                    <div>
                      <span>{item.selected_options.map((option) => option.value).join("／") || "一般規格"} × {quantity}</span>
                      <OrderItemGiftBreakdown items={registeredItems.filter((row) => registrationVariantKey(row.selected_options) === key)} />
                    </div>
                    {(lockedVariantQuantities.get(key) ?? 0) > 0
                      ? <span>含已收款品項，規格已鎖定</span>
                      : <button type="button" className="shop-product-retry" disabled={!canEdit || loading}
                        data-edit-variant={key}
                        aria-pressed={editingVariant === key} onClick={() => {
                          variantSelectionTouchedRef.current = true;
                          setEditingVariant(key);
                          setPicked(Object.fromEntries(item.selected_options.map((option) => [option.group_id, option.option_id])));
                          setQty(quantity);
                          setRegistrationUpdateMessage("");
                          requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(".shop-product-option")?.focus());
                        }}>修改尺寸／規格與數量</button>}
                  </li>)}</ul>
                  {editingVariant !== null && <p role="status">正在修改規格與數量</p>}
                </section>}

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
                              onClick={() => selectVariantOption(g.id, o.id)}
                              disabled={authLoading || loading}
                              className="shop-product-option"
                              aria-pressed={sel}>
                              {o.image_url && <Thumb url={o.image_url} alt={o.value} size={28} />}
                              <span>{o.value}</span>
                              <OptionPrice option={o} />
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}

                <ProductSizeChart product={product} picked={picked} onSelectOption={selectVariantOption} />

                <ProductDetailOffers product={product} promotions={promotions} registration={registration}
                  registrationState={authLoading || classStatusLoading ? "loading" : registrationLoadError ? "error" : "ready"} />
                {!bundleStep && bundleAddOn?.(loading || !canEdit)}

                {product.purchase_allowed === false && isLoggedIn && <p className="shop-product-purchase-hint" role="status">
                  {product.purchase_restriction ?? "您目前不符合此商品的購買資格"}
                </p>}
                {!testing && orderClosed ? (
                  <p className="shop-product-purchase-hint" role="status">
                    {registrationLockMessage({ registrationLocked, classClosed: classPaid, councilClosed, deadlinePassed })}
                  </p>
                ) : !isLoggedIn ? (
                  <p className="shop-product-purchase-hint" role="status">
                    {authLoading ? "正在確認登入狀態…" : "登入後即可登記商品。"}
                  </p>
                ) : classStatusLoading && !testing ? (
                  <p className="shop-product-purchase-hint" role="status">
                    正在確認商品分類結單狀態…
                  </p>
                ) : authorizationRequired ? (
                  <p className="shop-product-purchase-hint" role="status">
                    {adjustingClassMember
                      ? "正在確認班代權限，完成後即可調整。"
                      : <>
                        代訂需要學生授權。請輸入學生提供的七位數驗證碼，或開啟學生傳來的連結。
                        <button type="button" className="shop-product-delegation-action" onClick={onRequestDelegation}>
                          前往代訂，輸入驗證碼
                        </button>
                      </>}
                  </p>
                ) : registrationLoadError ? (
                  <p className="shop-product-purchase-hint" role="alert">
                    目前無法讀取商品登記，請重新載入頁面後再修改。
                  </p>
                ) : registrationLocked ? (
                  <p className="shop-product-purchase-hint" role="status">
                    {registrationLockMessage({ registrationLocked, classClosed: false, deadlinePassed: false })}
                  </p>
                ) : null}
              </div>
              <div className="shop-product-purchase-bar">
                {registrationUpdateMessage ? (
                  <p className="shop-product-registration-status" role={registrationUpdateError ? "alert" : "status"}>
                    {registrationUpdateMessage}
                  </p>
                ) : null}
                <div className="shop-product-dialog-section shop-product-quantity-section">
                  <label>數量</label>
                  {maxSelectedQuantity === 0 ? (
                    <p>{registeredQuantity > 0 ? "目前已達可登記數量。" : "目前沒有可登記數量。"}</p>
                  ) : singlePurchase ? (
                    <p>每人限購 1 件</p>
                  ) : (
                    <div className="shop-product-quantity">
                      <button
                        type="button"
                        onClick={() => changeSelectedQuantity(Math.max(minimumSelectedQuantity, qty - 1))}
                        disabled={qty <= minimumSelectedQuantity || !canEdit || loading}
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
                <div className="shop-product-dialog-actions">
                  {!testing && orderClosed ? (
                    <button type="button" className="shop-product-submit" disabled>
                      {councilClosed
                        ? "班聯已結單"
                        : classPaid
                          ? "班聯已確認本班收款"
                          : "登記已截止"}
                    </button>
                  ) : editingVariant !== null ? (
                    <>
                      <button type="button" className="shop-product-submit"
                        disabled={loading || !canRegister || !allPicked || qty > maxSelectedQuantity}
                        aria-busy={loading} onClick={() => void submit()}>
                        {loading ? "儲存中…" : "儲存修改"}
                      </button>
                      <button type="button" className="shop-product-cancel" disabled={loading}
                        onClick={() => {
                          const original = registeredVariants.get(editingVariant);
                          if (original) {
                            setPicked(Object.fromEntries(original.item.selected_options.map((option) => [option.group_id, option.option_id])));
                            setQty(original.quantity);
                          }
                          setEditingVariant(null);
                          setRegistrationUpdateMessage("");
                          requestAnimationFrame(() => Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("[data-edit-variant]") ?? [])
                            .find((button) => button.dataset.editVariant === editingVariant)?.focus());
                        }}>取消修改</button>
                    </>
                  ) : product.purchase_allowed === false && isLoggedIn && selectedRegistrationQuantity === 0 && !replacingVariant ? (
                    <button type="button" className="shop-product-submit" disabled>不符合購買資格</button>
                  ) : bundleStep && isLoggedIn ? (
                    <button type="button" className="shop-product-submit"
                      disabled={loading || !canRegister || !allPicked || qty > maxSelectedQuantity}
                      aria-busy={loading}
                      onClick={() => {
                        if (selectedRegistrationQuantity > 0) bundleStep.onContinue();
                        else void submit();
                      }}>
                      {loading ? "儲存中…" : bundleStep.nextLabel}
                    </button>
                  ) : isLoggedIn && selectedRegistrationQuantity > 0 ? (
                    <button
                      type="button"
                      onClick={() => void setVariantQuantity(
                        selectedOptionIds,
                        lockedSelectedQuantity,
                      )}
                      disabled={!canEdit || loading || (
                        selectedRegistrationQuantity <= lockedSelectedQuantity
                      )}
                      className="shop-product-remove">
                      {lockedSelectedQuantity > 0
                        ? selectedRegistrationQuantity > lockedSelectedQuantity
                          ? "移除可調整數量"
                          : "已保留鎖定數量"
                        : "移除這項登記"}
                    </button>
                  ) : isLoggedIn ? (
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={loading || !canRegister || qty > maxSelectedQuantity}
                      className="shop-product-submit"
                      aria-busy={loading}>
                      {loading
                        ? "處理中…"
                        : `${replacingVariant ? "更新選項" : "登記購買"} · NT$${offerTotal.toLocaleString()}`}
                    </button>
                  ) : (
                    <Link
                      href={`/login?next=${encodeURIComponent(productHref ?? `/shop?product=${productId}`)}`}
                      className="shop-product-submit">
                      登入後登記商品
                    </Link>
                  )}
                  {editingVariant === null && <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="shop-product-cancel">
                    {selectedRegistrationQuantity > 0 ? "完成" : "取消"}
                  </button>}
                </div>
                {bundleStep && !allPicked && <p className="shop-product-step-hint">
                  請先選擇{variantGroups.filter((group) => !picked[group.id]).map((group) => group.name).join("、")}，再繼續下一步。
                </p>}
                {bundleStep && selectedRegistrationQuantity > 0 && <button type="button"
                  className="shop-product-remove" disabled={loading || !canEdit}
                  onClick={() => void setVariantQuantity(selectedOptionIds, 0)}>移除這項登記</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
