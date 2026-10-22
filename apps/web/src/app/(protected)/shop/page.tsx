"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Gift,
  Package,
  UsersRound,
} from "lucide-react";
import { authApi, classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type {
  CatalogCategoryOut,
  CatalogProductOut,
  CloseStatusItem,
  ProductOut,
  MyClassContext,
  OrderOut,
  ShopPromotionPublicOut,
  ShopDelegationContextOut,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePersistedState } from "@/hooks/usePersistedState";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";
import { orderScopeKey, catalogScopeKey, orderScopeParams } from "@/lib/shop-order-scope";
import DelegationLinks from "@/components/shop/DelegationLinks";
import DelegationInstructions from "@/components/shop/DelegationInstructions";
import ParentDelegationEntry from "@/components/shop/ParentDelegationEntry";
import { readShopDelegationToken, shopDelegationLoginNext } from "@/lib/shop-delegation-link";
import { useWS } from "@/hooks/useWS";
import Modal from "@/components/ui/Modal";
import { resolveShopProductPath, shopProductHref } from "@/lib/shop-product-url";
import { cleanupAnimatedElement, shouldAnimateProductFlight } from "@/lib/shop-product-flight";
import ShopPrice from "@/components/shop/ShopPrice";
import BundleOffer from "@/components/shop/BundleOffer";
import BundleCarousel from "@/components/shop/BundleCarousel";
import BundleAddOn from "@/components/shop/BundleAddOn";
import { bundleProductAvailable, bundleProgress } from "@/lib/shop-bundle-progress";
import { productOfferPrice } from "@/lib/shop-promotion-price";
import ProductCardOffers from "@/components/shop/ProductCardOffers";
import { shopCardPrice, type ShopCardPrice } from "@/lib/shop-card-price";
import { categoryOrderable, defaultShopCategory, productDeadline } from "@/lib/shop-deadlines";

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

function aggregateRegistrationOrders(orders: OrderOut[]): OrderOut | null {
  if (orders.length === 0) return null;
  const first = orders[0];
  return {
    ...first,
    subtotal_price: orders.reduce((total, order) => total + order.subtotal_price, 0),
    discount_amount: orders.reduce((total, order) => total + order.discount_amount, 0),
    total_price: orders.reduce((total, order) => total + order.total_price, 0),
    is_paid: orders.every((order) => order.is_paid),
    is_class_collected: orders.every((order) => order.is_class_collected),
    items: orders.flatMap((order) => order.items),
    applied_promotions: orders.flatMap((order) => order.applied_promotions ?? []),
  };
}

function promotionRequirementsMet(
  promotion: ShopPromotionPublicOut,
  registration: OrderOut | null,
) {
  if (!registration) return false;

  const targets = promotion.target_products ?? [];
  const targetIds = new Set(targets.map((product) => product.id));
  const registeredProducts = new Set(registration.items.map((item) => item.product_id));
  const matchingQuantity = registration.items.reduce((total, item) => (
    targetIds.size === 0 || targetIds.has(item.product_id) ? total + item.quantity : total
  ), 0);
  const productRequirementMet = promotion.discount_type === "price_override"
    ? targets.some((product) => registeredProducts.has(product.id))
    : targets.every((product) => registeredProducts.has(product.id));

  return productRequirementMet
    && matchingQuantity >= promotion.min_quantity
    && registration.subtotal_price >= promotion.min_order_price;
}

function flyProductIntoOrder() {
  if (typeof window === "undefined") return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const compactPortrait = window.matchMedia("(max-width: 859px) and (orientation: portrait)").matches;
  if (!shouldAnimateProductFlight(reducedMotion, compactPortrait)) return;

  window.requestAnimationFrame(() => {
    const source = document.querySelector<HTMLElement>("[data-product-flight-source]");
    const orderLink = document.querySelector<HTMLElement>("[data-order-flight-target]");
    const registrationSummary = document.querySelector<HTMLElement>("[data-registration-flight-target]");
    if (!source) return;

    const linkBounds = orderLink?.getBoundingClientRect();
    const orderLinkIsVisible = linkBounds
      && linkBounds.bottom > 0
      && linkBounds.top < window.innerHeight
      && linkBounds.right > 0
      && linkBounds.left < window.innerWidth;
    const target = orderLinkIsVisible ? orderLink : registrationSummary ?? orderLink;
    if (!target) return;

    const sourceBounds = source.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const flyer = source.cloneNode(true) as HTMLElement;
    const sourceStyle = window.getComputedStyle(source);
    flyer.setAttribute("aria-hidden", "true");
    flyer.removeAttribute("data-product-flight-source");
    flyer.removeAttribute("id");
    flyer.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    Object.assign(flyer.style, {
      position: "fixed",
      top: `${sourceBounds.top}px`,
      left: `${sourceBounds.left}px`,
      width: `${sourceBounds.width}px`,
      height: `${sourceBounds.height}px`,
      minWidth: "0",
      minHeight: "0",
      maxWidth: "none",
      margin: "0",
      borderRadius: sourceStyle.borderRadius,
      objectFit: sourceStyle.objectFit || "contain",
      transformOrigin: "center",
      pointerEvents: "none",
      zIndex: "10001",
    });
    document.body.append(flyer);

    if (typeof flyer.animate !== "function") {
      flyer.remove();
      return;
    }

    const deltaX = targetBounds.left + targetBounds.width / 2
      - sourceBounds.left - sourceBounds.width / 2;
    const deltaY = targetBounds.top + targetBounds.height / 2
      - sourceBounds.top - sourceBounds.height / 2;
    const animationDuration = 560;
    const animation = flyer.animate([
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
      {
        transform: `translate3d(${deltaX * 0.48}px, ${deltaY * 0.48 - 28}px, 0) scale(0.72) rotate(-5deg)`,
        opacity: 0.95,
        offset: 0.52,
      },
      { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.18)`, opacity: 0.2 },
    ], {
      duration: animationDuration,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "forwards",
    });
    cleanupAnimatedElement(flyer, animation, animationDuration + 300);
  });
}

const GENERAL_ACTIVITY_SCOPE = "none";

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
  if (classClosed) return "本班已停止訂購，如需更改請聯繫班代";
  if (deadlinePassed) return "商品登記已截止";
  return "登入後即可登記商品";
}

// ── 商品變體選購 Modal ────────────────────────────────────────────────────────

function ProductModal({
  productId,
  shoppingApi,
  classClosed,
  isLoggedIn,
  authLoading,
  registrationLoadError,
  registration,
  scopeKey,
  registrationLocked,
  authorizationRequired = false,
  editingDescription,
  productHref,
  onClose,
  onRegistrationChange,
  onProductAdded,
  onRequestDelegation,
  onClassMemberRegistrationChange,
  classMemberUserId,
  lockedVariantQuantities,
  promotions,
  activityId,
  bundleStep,
  bundleAddOn,
}: {
  productId: string;
  shoppingApi: Pick<typeof shopApi, "getProduct" | "setCurrentRegistrationProduct" | "setClassMemberProduct">;
  classClosed: boolean;
  isLoggedIn: boolean;
  authLoading: boolean;
  registrationLoadError: boolean;
  registration: OrderOut | null;
  scopeKey: string;
  registrationLocked: boolean;
  authorizationRequired?: boolean;
  editingDescription?: string;
  productHref: string | null;
  onClose: () => void;
  onRegistrationChange: (scopeKey: string, order: OrderOut | null) => void;
  onProductAdded: () => void;
  onRequestDelegation: () => void;
  onClassMemberRegistrationChange: (orders: OrderOut[]) => void;
  classMemberUserId: string | null;
  lockedVariantQuantities: Map<string, number>;
  promotions: ShopPromotionPublicOut[];
  activityId: string | null;
  bundleStep?: { name: string; nextLabel: string; onContinue: () => void };
  bundleAddOn?: (disabled: boolean) => React.ReactNode;
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
  const mediaSwipeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
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
      setProduct(await shoppingApi.getProduct(productId));
    } catch {
      setProductLoadError(true);
    } finally {
      setProductLoading(false);
    }
  }, [productId, shoppingApi]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  useEffect(() => {
    registrationItemsRef.current = registration?.items ?? [];
  }, [registration?.items]);

  useEffect(() => {
    if (registrationUpdateInFlightRef.current) return;
    const signature = Object.values(picked).sort().join(",");
    const quantity = (registration?.items ?? [])
      .filter((item) => item.product_id === loadedProductId
        && registrationVariantKey(item.selected_options) === signature)
      .reduce((total, item) => total + item.quantity, 0);
    if (quantity > 0) setQty(quantity);
  }, [registration?.items, loadedProductId, picked]);

  useEffect(() => {
    if (!loadedProductId) return;
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
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled])",
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
  const offerPrice = product ? productOfferPrice(product, promotions, activityId, registration, delta) : unitPrice;
  const offerTotal = product ? productOfferPrice(product, promotions, activityId, registration, delta, qty) : unitPrice * qty;
  const allPicked = variantGroups.every((g) => picked[g.id]);
  const registeredItems = registration?.items.filter((item) => item.product_id === product?.id) ?? [];
  const registeredQuantity = registeredItems.reduce((total, item) => total + item.quantity, 0);
  const selectedOptionIds = Object.values(picked).sort();
  const selectedRegistrationQuantity = registeredItems
    .filter((item) => registrationVariantKey(item.selected_options) === selectedOptionIds.join(","))
    .reduce((total, item) => total + item.quantity, 0);
  const lockedSelectedQuantity = classMemberUserId
    ? lockedVariantQuantities.get(selectedOptionIds.join(",")) ?? 0
    : 0;
  const minimumSelectedQuantity = classMemberUserId
    ? Math.max(lockedSelectedQuantity, selectedRegistrationQuantity > 0 ? 0 : 1)
    : selectedRegistrationQuantity > 0 ? 0 : 1;
  const remainingForUser = product?.max_quantity_per_user == null
    ? null
    : classMemberUserId
      ? Math.max(0, product.max_quantity_per_user - registeredQuantity)
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
  const deadline = product ? productDeadline(product) : null;
  const testing = product?.status === "testing";
  const deadlinePassed = !testing && Boolean(deadline && new Date(deadline).getTime() <= Date.now());
  const available = Boolean(
    product
      && (product.status === "active" || testing || registeredQuantity > 0)
      && (product.is_unlimited || product.stock_quantity > 0 || registeredQuantity > 0),
  );
  const canEdit = isLoggedIn
    && !authorizationRequired
    && !authLoading
    && !registrationLoadError
    && !registrationLocked
    && (testing || !classClosed)
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
      if (classMemberUserId) {
        const updatedOrders = await shoppingApi.setClassMemberProduct(classMemberUserId, product.id, {
          variants: [...currentVariants.values()],
        });
        onClassMemberRegistrationChange(updatedOrders);
      } else {
        const updated = await shoppingApi.setCurrentRegistrationProduct(product.id, {
          variants: [...currentVariants.values()],
        });
        onRegistrationChange(
          scopeKey,
          updated?.status === "cancelled" ? null : updated,
        );
      }
      if (!classMemberUserId && quantity > 0 && !wasRegistered) onProductAdded();
      if (key === selectedOptionIds.join(",")) setQty(quantity > 0 ? quantity : 1);
      setRegistrationUpdateMessage(quantity > 0
        ? wasRegistered ? `已更新為 ${quantity} 件。` : `已登記 ${quantity} 件。`
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
    if (selectedRegistrationQuantity > 0 || lockedSelectedQuantity > 0) {
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
              data-product-flight-source
              src={uploadUrl(displayMedia.image_url)}
              alt={`${product.name}・${displayLabel}`}
              draggable={false}
              onPointerDown={startMediaSwipe}
              onPointerUp={finishMediaSwipe}
              onPointerCancel={cancelMediaSwipe}
            />
          ) : (
            <div className="shop-product-dialog-placeholder" data-product-flight-source>
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
                <div className="shop-product-dialog-heading">
                  <h3 id="product-modal-title">{product.name}</h3>
                  <ShopPrice original={unitPrice} current={offerPrice} />
                  {bundleStep && <p className="shop-product-purchase-hint">正在選購「{bundleStep.name}」，每項各一件；選齊後享套組價。</p>}
                  {bundleAddOn?.(loading || !canEdit)}
                  {editingDescription && <p className="shop-product-purchase-hint">{editingDescription}</p>}
                  {product.description && <p className="whitespace-pre-line">{product.description}</p>}
                  {!product.is_unlimited && product.status === "active" && (
                    <p className="shop-product-dialog-stock">剩餘 {product.stock_quantity} 件</p>
                  )}
                  {product.max_quantity_per_user != null && (
                    <p className="shop-product-dialog-stock">
                      每人限購 {product.max_quantity_per_user} 件
                      {remainingForUser != null && ` · ${classMemberUserId ? "此同學" : "此帳號"}尚可選 ${remainingForUser} 件`}
                    </p>
                  )}
                  {classMemberUserId && lockedSelectedQuantity > 0 && (
                    <p className="shop-product-purchase-hint">
                      已收款或鎖定 {lockedSelectedQuantity} 件，調整時會保留這個數量。
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

                {!isLoggedIn ? (
                  <p className="shop-product-purchase-hint" role="status">
                    {authLoading ? "正在確認登入狀態…" : "登入後即可登記商品。"}
                  </p>
                ) : authorizationRequired ? (
                  <p className="shop-product-purchase-hint" role="status">
                    {classMemberUserId
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
                ) : (registrationLocked || (!testing && classClosed) || deadlinePassed) ? (
                  <p className="shop-product-purchase-hint" role="status">
                    {registrationLockMessage({ registrationLocked, classClosed, deadlinePassed })}
                  </p>
                ) : null}
              </div>
              <div className="shop-product-purchase-bar">
                {registrationUpdateMessage ? (
                  <p className="shop-product-registration-status" role="status" aria-live="polite">
                    {registrationUpdateMessage}
                  </p>
                ) : null}
                <div className="shop-product-dialog-section shop-product-quantity-section">
                  <label>數量</label>
                  {maxSelectedQuantity === 0 ? (
                    <p>{registeredQuantity > 0 ? "目前已達可登記數量。" : "目前沒有可登記數量。"}</p>
                  ) : product.max_quantity_per_user === 1 ? (
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
                  {isLoggedIn && selectedRegistrationQuantity > 0 ? (
                    <button
                      type="button"
                      onClick={() => void setVariantQuantity(
                        selectedOptionIds,
                        classMemberUserId ? lockedSelectedQuantity : 0,
                      )}
                      disabled={!canEdit || loading || (
                        Boolean(classMemberUserId) && selectedRegistrationQuantity <= lockedSelectedQuantity
                      )}
                      className="shop-product-remove">
                      {classMemberUserId && lockedSelectedQuantity > 0
                        ? selectedRegistrationQuantity > lockedSelectedQuantity
                          ? "移除可調整數量"
                          : "已保留鎖定數量"
                        : "移除這項登記"}
                    </button>
                  ) : isLoggedIn ? (
                    <button
                      type="button"
                      onClick={submit}
                      disabled={loading || !canRegister || qty > maxSelectedQuantity}
                      className="shop-product-submit"
                      aria-busy={loading}>
                      {loading
                        ? "處理中…"
                        : `登記購買 · NT$${offerTotal.toLocaleString()}`}
                    </button>
                  ) : (
                    <Link
                      href={`/login?next=${encodeURIComponent(productHref ?? `/shop?product=${productId}`)}`}
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
                  {bundleStep && isLoggedIn && <button type="button" className="shop-product-submit"
                    disabled={loading || !canEdit || registeredQuantity === 0} onClick={bundleStep.onContinue}>
                    {bundleStep.nextLabel}
                  </button>}
                </div>
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
  canAdjustRegistration,
  href,
  onClick,
  cardPrice,
  promotions,
  products,
  offersLocked,
  onSelectBundle,
  bundleHint,
}: {
  product: CatalogProductOut;
  classClosed: boolean;
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
}) {
  const testing = product.status === "testing";
  const soldOut = product.status === "sold_out" || (testing && !product.is_unlimited && product.stock_quantity === 0);
  const deadline = productDeadline(product);
  const deadlinePassed = !testing && Boolean(deadline && new Date(deadline).getTime() <= Date.now());
  const locked = (!testing && classClosed) || deadlinePassed;
  const disabled = (soldOut || locked) && registeredQuantity === 0;
  const statusLabel = testing
    ? "測試中・正式開放時清除試訂紀錄"
    : classClosed
    ? "本班已停止訂購"
    : deadlinePassed
      ? "登記已截止"
      : registeredQuantity > 0
        ? `已登記 ${registeredQuantity} 件`
        : soldOut
          ? "已售完"
          : null;
  const className = "shop-public-product-card group";
  const style = { opacity: disabled ? 0.6 : 1 };
  const content = (
    <>
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
            <ShopPrice original={cardPrice.original} current={cardPrice.current} suffix={!cardPrice.note && product.has_variants ? " 起" : undefined} />
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
        <span className="shop-public-product-action">
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
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          onClick();
        }}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        className={className}
        style={style}
        aria-label={`查看商品：${product.name}`}>
        {content}
      </Link>
    ) : (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={className}
        style={style}
        aria-label={`查看商品：${product.name}`}>
        {content}
      </button>
    )}
    <ProductCardOffers product={product} promotions={promotions} products={products}
      disabled={disabled || offersLocked} onSelectBundle={onSelectBundle} />
  </article>;
}

// ── 購買頁 ────────────────────────────────────────────────────────────────────

type ShopPageProps = {
  topicSlug?: string;
  productSlug?: string;
};

export default function ShopPage({ topicSlug, productSlug }: ShopPageProps = {}) {
  const router = useRouter();
  const catalogCacheKey = "shop/catalog/all:v2";

  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>(() => cacheGet<CatalogCategoryOut[]>(catalogCacheKey) ?? []);
  const [catalogTime, setCatalogTime] = useState(Date.now);
  const [loading, setLoading] = useState(!cacheHas(catalogCacheKey));
  const [loadError, setLoadError] = useState(false);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [routeProductNotFound, setRouteProductNotFound] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isStudent, setIsStudent] = useState(false);
  const [canOrderForSelf, setCanOrderForSelf] = useState(false);
  const [currentAccount, setCurrentAccount] = useState("");
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const [delegationToken, setDelegationToken] = useState<string | null>(null);
  const [delegationContext, setDelegationContext] = useState<ShopDelegationContextOut | null>(null);
  const [delegationError, setDelegationError] = useState("");
  const [delegationBusy, setDelegationBusy] = useState(false);
  const refreshGeneration = useRef(0);
  const mutationBusy = useRef(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [registrationLoadError, setRegistrationLoadError] = useState(false);
  const [registrations, setRegistrations] = useState<OrderOut[]>([]);
  const [classMemberUserId, setClassMemberUserId] = useState<string | null>(null);
  const [classMemberName, setClassMemberName] = useState("");
  const [classMemberAccess, setClassMemberAccess] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [availablePromotions, setAvailablePromotions] = useState<ShopPromotionPublicOut[]>([]);
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [selectedPromotionScope, setSelectedPromotionScope] = useState(GENERAL_ACTIVITY_SCOPE);
  const [promotionFeedback, setPromotionFeedback] = useState("");
  const [promotionCelebration, setPromotionCelebration] = useState<{
    promotionIds: string[];
    token: number;
  } | null>(null);
  const promotionCelebrationToken = useRef(0);
  const promotionCelebrationTimer = useRef<number | null>(null);
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [myClass, setMyClass] = useState<MyClassContext | null>(null);
  const [classLoadFailed, setClassLoadFailed] = useState(false);
  const [orderShortcutPortalReady, setOrderShortcutPortalReady] = useState(false);
  const [compactShortcuts, setCompactShortcuts] = useState(false);
  const [shortcutSlot, setShortcutSlot] = useState<HTMLDivElement | null>(null);
  const [delegationOpen, setDelegationOpen] = useState(false);
  const delegationTriggerRef = useRef<HTMLButtonElement>(null);
  const delegationReopenRef = useRef<HTMLButtonElement>(null);
  const delegationReadyRef = useRef<HTMLHeadingElement>(null);
  const [selectedCategoryId, setSelectedCategoryId] = usePersistedState<string | null>("hcca:pref:shop:category:v1", null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 767px)");
    if (!media) return;
    setCompactShortcuts(media.matches);
    const update = (event: MediaQueryListEvent) => setCompactShortcuts(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setOrderShortcutPortalReady(true);
    const query = new URLSearchParams(window.location.search);
    setClassMemberUserId(query.get("class_member_user_id"));
    setClassMemberName(query.get("class_member_name") ?? "");
    if (query.get("delegation") === "entry") {
      setDelegationOpen(true);
      query.delete("delegation");
      const search = query.toString();
      window.history.replaceState(window.history.state, "",
        `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    }
  }, []);

  const closeProduct = useCallback(() => {
    setOpenProduct(null);
    setActiveBundleId(null);
    if (productSlug) {
      router.push("/shop");
      return;
    }
    if (new URLSearchParams(window.location.search).has("product")) {
      router.replace("/shop");
    }
  }, [productSlug, router]);

  const closeDelegation = useCallback(() => {
    setDelegationOpen(false);
    window.requestAnimationFrame(() => {
      (delegationToken ? delegationReopenRef : delegationTriggerRef).current?.focus();
    });
  }, [delegationToken]);

  useEffect(() => () => {
    if (promotionCelebrationTimer.current !== null) {
      window.clearTimeout(promotionCelebrationTimer.current);
    }
  }, []);

  const celebratePromotionThresholds = (promotionIds: string[]) => {
    if (promotionIds.length === 0) return;
    if (promotionCelebrationTimer.current !== null) {
      window.clearTimeout(promotionCelebrationTimer.current);
    }
    const token = ++promotionCelebrationToken.current;
    setPromotionCelebration({ promotionIds, token });
    promotionCelebrationTimer.current = window.setTimeout(() => {
      setPromotionCelebration((current) => current?.token === token ? null : current);
      promotionCelebrationTimer.current = null;
    }, 1200);
  };

  const loadCatalog = useCallback(() => {
    const generation = refreshGeneration.current;
    if (!cacheHas(catalogCacheKey)) setLoading(true);
    setLoadError(false);
    shopApi
      .catalog()
      .then(async (data) => {
        if (generation !== refreshGeneration.current) return;
        setCatalog(data);
        cacheSet(catalogCacheKey, data);
        try {
          const schoolClass = await classApi.myClass();
          if (generation !== refreshGeneration.current) return;
          setMyClass(schoolClass);
          setClassLoadFailed(false);
          if (schoolClass && data.length) {
            const catIds = data.map((c) => c.id);
            const status = await shopApi.getCloseStatus(catIds, schoolClass.id);
            if (generation !== refreshGeneration.current) return;
            setCloseStatus(status.statuses);
          } else {
            setCloseStatus({});
          }
        } catch {
          if (generation === refreshGeneration.current) {
            setMyClass(null);
            setClassLoadFailed(true);
          }
        }
      })
      .catch(() => { if (generation === refreshGeneration.current) setLoadError(true); })
      .finally(() => { if (generation === refreshGeneration.current) setLoading(false); });
  }, [catalogCacheKey]);

  const loadDelegation = useCallback(async (token: string, claim = false) => {
    const generation = refreshGeneration.current;
    if (token === "invalid") {
      setDelegationError("代訂連結無法接續，請重新開啟家人分享的連結。");
      setRegistrationLoadError(true);
      setLoading(false);
      return null;
    }
    try {
      const context = await shopApi.accessDelegation(token, claim);
      if (generation !== refreshGeneration.current) return null;
      setDelegationContext(context);
      setDelegationError("");
      setRegistrationLoadError(false);
      const scopedCatalog = context.catalog ?? [];
      setCatalog(scopedCatalog);
      setSelectedCategoryId((current) => scopedCatalog.some((row) => row.id === current)
        ? current : scopedCatalog[0]?.id ?? null);
      setRegistrations(context.registration ? [context.registration] : []);
      setAvailablePromotions(context.promotions ?? []);
      setCloseStatus(Object.fromEntries((context.closed_category_ids ?? []).map((id) => [id, { is_closed: true }])));
      setLoading(false);
      return context;
    } catch (error) {
      if (generation !== refreshGeneration.current) return null;
      setDelegationError(apiErrorMessage(error, "無法使用代訂連結"));
      setRegistrationLoadError(true);
      setDelegationContext(null);
      setRegistrations([]);
      setLoading(false);
      return null;
    }
  }, [setSelectedCategoryId]);

  const loadClassMemberOrders = useCallback(async (memberUserId: string, initial = false) => {
    const generation = initial ? ++refreshGeneration.current : refreshGeneration.current;
    if (initial) {
      setClassMemberAccess((current) => current === "ready" ? "ready" : "loading");
      setRegistrationLoadError(false);
    }
    try {
      const orders = await shopApi.listClassMemberRegistrations(memberUserId);
      if (generation !== refreshGeneration.current) return;
      setRegistrations(orders);
      setClassMemberAccess("ready");
      setRegistrationLoadError(false);
    } catch (error) {
      if (generation !== refreshGeneration.current) return;
      setClassMemberAccess((current) => current === "ready" ? "ready" : "error");
      if (initial) {
        setRegistrationLoadError(true);
        toast.error(apiErrorMessage(error, "無法載入這位同學的商品登記"));
      }
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn || authLoading || !classMemberUserId || delegationToken) return;
    void loadClassMemberOrders(classMemberUserId, true);
  }, [isLoggedIn, authLoading, classMemberUserId, delegationToken, loadClassMemberOrders]);

  const shoppingApi = useMemo(() => {
    const mutate = async <T,>(operation: () => Promise<T>) => {
      const generation = ++refreshGeneration.current;
      mutationBusy.current = true;
      try {
        const result = await operation();
        if (generation !== refreshGeneration.current) throw new Error("商品登記已更新，請查看目前頁面。");
        return result;
      }
      finally { mutationBusy.current = false; }
    };
    if (!delegationToken) return {
      ...shopApi,
      setCurrentRegistrationProduct: (id: string, body: Parameters<typeof shopApi.setCurrentRegistrationProduct>[1]) =>
        mutate(() => shopApi.setCurrentRegistrationProduct(id, body)),
      setClassMemberProduct: (
        memberUserId: string,
        id: string,
        body: Parameters<typeof shopApi.setClassMemberProduct>[2],
      ) => mutate(() => shopApi.setClassMemberProduct(memberUserId, id, body)),
      applyCurrentPromotion: (code: string | null, activityId: string | null, categoryId?: string | null) =>
        mutate(() => shopApi.applyCurrentPromotion(code, activityId, categoryId)),
    };
    return {
      ...shopApi,
      getProduct: (id: string) => shopApi.getDelegationProduct(delegationToken, id),
      setCurrentRegistrationProduct: (id: string, body: Parameters<typeof shopApi.setCurrentRegistrationProduct>[1]) =>
        mutate(() => shopApi.setDelegationProduct(delegationToken, id, body)),
      setClassMemberProduct: (
        memberUserId: string,
        id: string,
        body: Parameters<typeof shopApi.setClassMemberProduct>[2],
      ) => mutate(() => shopApi.setClassMemberProduct(memberUserId, id, body)),
      previewCurrentPromotion: (code: string | null) => shopApi.previewDelegationPromotion(delegationToken, code),
      applyCurrentPromotion: (code: string | null) => mutate(() => shopApi.applyDelegationPromotion(delegationToken, code)),
    };
  }, [delegationToken]);

  useEffect(() => {
    let active = true;
    const token = readShopDelegationToken();
    setDelegationToken(token);
    setDelegationOpen((alreadyOpen) => alreadyOpen || Boolean(token));
    if (!token) {
      loadCatalog();
      const generation = refreshGeneration.current;
      void shopApi.listAvailablePromotions()
        .then((promotions) => { if (active && generation === refreshGeneration.current) setAvailablePromotions(promotions); })
        .catch(() => { if (active && generation === refreshGeneration.current) setAvailablePromotions([]); });
    } else {
      setCatalog([]);
      setLoading(true);
    }
    void authApi.refresh().then(async (user) => {
      if (!active) return;
      setIsLoggedIn(true);
      setIsStudent(user.can_create_shop_delegation ?? Boolean(user.student_id));
      setCanOrderForSelf(Boolean(user.can_create_shop_delegation || user.student_id || user.is_school_email));
      setCurrentAccount(`${user.display_name}（${user.email}）`);
      setUserRoom(`user:${user.id}`);
      const currentToken = readShopDelegationToken();
      setDelegationToken(currentToken);
      if (currentToken) {
        await loadDelegation(currentToken);
      } else if (!new URLSearchParams(window.location.search).get("class_member_user_id")) {
        const generation = refreshGeneration.current;
        try {
          const orders = await shopApi.getCurrentRegistrations();
          if (active && generation === refreshGeneration.current) setRegistrations(orders);
        }
        catch (error) {
          if (!active || generation !== refreshGeneration.current) return;
          setRegistrationLoadError(true);
          toast.error(apiErrorMessage(error, "無法載入商品登記"));
        }
      }
    }).catch(() => {
      if (!active) return;
      setIsLoggedIn(false);
      setRegistrations([]);
      if (token) setLoading(false);
    }).finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [loadCatalog, loadDelegation]);

  useEffect(() => {
    const changeContext = () => {
      if (delegationToken && window.location.hash === "#main-content") {
        // 公開頁的「跳到主要內容」只移動焦點，保留目前代訂身分與分享連結。
        window.history.replaceState(window.history.state, "",
          `${window.location.pathname}${window.location.search}#delegate=${encodeURIComponent(delegationToken)}`);
        return;
      }
      refreshGeneration.current += 1;
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.has("delegate") ? fragment.get("delegate") || "invalid" : null;
      setDelegationOpen(Boolean(token));
      setDelegationToken(token);
      setDelegationContext(null);
      setDelegationError("");
      setRegistrations([]);
      setOpenProduct(null);
      const classMemberId = new URLSearchParams(window.location.search).get("class_member_user_id");
      setClassMemberUserId(classMemberId);
      setClassMemberName(new URLSearchParams(window.location.search).get("class_member_name") ?? "");
      setClassMemberAccess("idle");
      setMyClass(null);
      setLoadError(false);
      setRegistrationLoadError(false);
      setAvailablePromotions([]);
      setCloseStatus({});
      if (token) {
        setCatalog([]);
        setLoading(isLoggedIn);
        if (isLoggedIn) void loadDelegation(token);
      } else {
        loadCatalog();
        const generation = refreshGeneration.current;
        void shopApi.listAvailablePromotions()
          .then((promotions) => { if (generation === refreshGeneration.current) setAvailablePromotions(promotions); })
          .catch(() => { if (generation === refreshGeneration.current) setAvailablePromotions([]); });
        if (isLoggedIn && classMemberId && classMemberId === classMemberUserId) {
          void loadClassMemberOrders(classMemberId, true);
        } else if (isLoggedIn && !classMemberId) {
          void shopApi.getCurrentRegistrations()
            .then((orders) => { if (generation === refreshGeneration.current) setRegistrations(orders); })
            .catch(() => { if (generation === refreshGeneration.current) setRegistrationLoadError(true); });
        }
      }
    };
    window.addEventListener("hashchange", changeContext);
    return () => window.removeEventListener("hashchange", changeContext);
  }, [isLoggedIn, delegationToken, classMemberUserId, loadCatalog, loadDelegation, loadClassMemberOrders]);

  const refreshRegistrations = useCallback(async () => {
    if (!isLoggedIn || authLoading || mutationBusy.current || document.visibilityState === "hidden") return;
    if (delegationToken) {
      await loadDelegation(delegationToken);
    } else if (classMemberUserId) {
      await loadClassMemberOrders(classMemberUserId);
    } else {
      const generation = refreshGeneration.current;
      try {
        const orders = await shopApi.getCurrentRegistrations();
        if (generation === refreshGeneration.current) setRegistrations(orders);
      } catch { /* 保留已載入內容；下一次同步重試。 */ }
    }
  }, [isLoggedIn, authLoading, delegationToken, classMemberUserId, loadDelegation, loadClassMemberOrders]);
  useEffect(() => {
    if (!isLoggedIn || authLoading) return;
    const timer = window.setInterval(() => void refreshRegistrations(), 5000);
    const refresh = () => void refreshRegistrations();
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [isLoggedIn, authLoading, refreshRegistrations]);
  useWS(userRoom, (message) => {
    if (message.type === "order.updated") void refreshRegistrations();
  });

  useEffect(() => {
    const productId = new URLSearchParams(window.location.search).get("product");
    if (!productId && !productSlug) {
      setRouteProductNotFound(false);
      return;
    }
    if (catalog.length === 0) {
      if (!loading && productSlug) setRouteProductNotFound(true);
      return;
    }

    const routeProduct = productSlug
      ? resolveShopProductPath(catalog, topicSlug ? [topicSlug, productSlug] : [productSlug])
      : null;
    const entry = productId
      ? catalog.flatMap((category) => [
          ...category.products.map((product) => ({ category, product })),
          ...category.series.flatMap((series) => series.products.map((product) => ({ category, product }))),
        ]).find(({ product }) => product.id === productId) ?? null
      : routeProduct;
    if (!entry) {
      setRouteProductNotFound(Boolean(productSlug));
      return;
    }

    setRouteProductNotFound(false);
    setSelectedCategoryId(entry.category.id);
    setSelectedSeriesId(null);
    setOpenProduct(entry.product.id);
  }, [catalog, loading, productSlug, topicSlug, setSelectedCategoryId]);

  const openProductHref = useMemo(() => {
    if (!openProduct) return null;
    for (const category of catalog) {
      const product = [
        ...category.products,
        ...category.series.flatMap((series) => series.products),
      ].find((candidate) => candidate.id === openProduct);
      if (product) return shopProductHref(catalog, category, product);
    }
    return null;
  }, [catalog, openProduct]);

  const selectedCategory =
    catalog.find((category) => category.id === selectedCategoryId) ?? catalog[0] ?? null;

  useEffect(() => {
    const now = Date.now();
    const transitions = catalog.flatMap((category) => [
      ...category.products, ...category.series.flatMap((series) => series.products),
    ]).flatMap((product) => [product.sale_start, productDeadline(product)])
      .flatMap((value) => value && new Date(value).getTime() > now ? [new Date(value).getTime()] : []);
    const refresh = () => setCatalogTime(Date.now());
    const next = transitions.length ? Math.min(...transitions) : null;
    const timer = next == null ? null : window.setTimeout(refresh, Math.min(next - now + 10, 2_147_483_647));
    window.addEventListener("focus", refresh);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [catalog, catalogTime]);

  useEffect(() => {
    if (loading || delegationToken || topicSlug || productSlug
      || new URLSearchParams(window.location.search).has("product")) return;
    setSelectedCategoryId((current) => defaultShopCategory(catalog, current, Date.now(), closeStatus)?.id ?? null);
    setSelectedSeriesId(null);
  }, [catalog, catalogTime, closeStatus, loading, delegationToken, topicSlug, productSlug, setSelectedCategoryId]);

  useEffect(() => {
    if (!catalog.length) return;
    const category = catalog.find((item) => item.id === selectedCategoryId) ?? catalog[0];
    setSelectedPromotionScope(catalogScopeKey(category));
  }, [catalog, selectedCategoryId]);

  const selectedCategoryScope = selectedCategory ? catalogScopeKey(selectedCategory) : GENERAL_ACTIVITY_SCOPE;
  const selectedCategoryRegistrationOrders = registrations.filter(
    (order) => !order.test_product_id && orderScopeKey(order) === selectedCategoryScope,
  );
  const selectedCategoryRegistration = classMemberUserId
    ? aggregateRegistrationOrders(selectedCategoryRegistrationOrders)
    : selectedCategoryRegistrationOrders[0] ?? null;
  const delegatedRegistration = delegationContext ? registrations[0] ?? null : null;
  const testingProduct = catalog.flatMap((category) => [
    ...category.products, ...category.series.flatMap((series) => series.products),
  ]).some((product) => product.id === openProduct && product.status === "testing");
  const productRegistration = testingProduct
    ? registrations.find((order) => order.test_product_id === openProduct) ?? null
    : selectedCategoryRegistration;
  const registeredByProduct = new Map<string, number>();
  for (const item of registrations.filter((order) => orderScopeKey(order) === selectedCategoryScope).flatMap((order) => order.items)) {
    registeredByProduct.set(
      item.product_id,
      (registeredByProduct.get(item.product_id) ?? 0) + item.quantity,
    );
  }
  const lockedVariantQuantities = new Map<string, number>();
  if (classMemberUserId) {
    for (const order of selectedCategoryRegistrationOrders) {
      if (!order.is_paid && !order.is_class_collected) continue;
      for (const item of order.items) {
        if (item.product_id !== openProduct) continue;
        const variantKey = registrationVariantKey(item.selected_options);
        lockedVariantQuantities.set(
          variantKey,
          (lockedVariantQuantities.get(variantKey) ?? 0) + item.quantity,
        );
      }
    }
  }
  const registrationLocked = Boolean(
    (delegationToken && !delegationContext?.can_edit)
    || (!classMemberUserId && productRegistration
      && (productRegistration.is_paid || productRegistration.is_class_collected)),
  );

  const inspectAndApplyPromotion = async (
    code: string | null,
    requestedScopeKey = selectedPromotionScope,
  ) => {
    if (classMemberUserId) {
      setPromotionFeedback("班代調整商品總量時不會變更學生的優惠設定。");
      return;
    }
    const scope = orderScopeParams(requestedScopeKey);
    const registration = registrations.find(
      (order) => !order.test_product_id && orderScopeKey(order) === requestedScopeKey,
    ) ?? null;
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
    if (registration.is_paid || registration.is_class_collected) {
      setPromotionFeedback("目前登記已鎖定，如需更改優惠請聯繫班級幹部。");
      return;
    }
    setPromotionFeedback("");
    try {
      const preview = await shoppingApi.previewCurrentPromotion(code, scope.activity_id ?? null, scope.category_id);
      if (!preview.eligible) {
        setPromotionFeedback(preview.reason ?? "目前尚未符合優惠條件。");
        return;
      }
      const updated = await shoppingApi.applyCurrentPromotion(code, scope.activity_id ?? null, scope.category_id);
      setRegistrations((current) => [
        ...current.filter((order) => order.test_product_id || orderScopeKey(order) !== requestedScopeKey),
        updated,
      ]);
      setPromotionFeedback(preview.reason ?? "優惠已套用。");
    } catch (error) {
      const message = apiErrorMessage(error, "優惠套用失敗");
      setPromotionFeedback(message);
      toast.error(message);
    }
  };

  const handleRegistrationChange = async (scopeKey: string, order: OrderOut | null) => {
    refreshGeneration.current += 1;
    if (testingProduct) {
      setRegistrations((current) => [
        ...current.filter((existing) => existing.test_product_id !== openProduct),
        ...(order ? [order] : []),
      ]);
      return;
    }
    const scope = orderScopeParams(scopeKey);
    const activityId = scope.activity_id ?? null;
    if (order) {
      const previousOrder = registrations.find((existing) => !existing.test_product_id && orderScopeKey(existing) === scopeKey) ?? null;
      const newlyQualifiedPromotions = availablePromotions
        .filter((promotion) => (promotion.activity_id ?? null) === activityId)
        .filter((promotion) => (
          !promotionRequirementsMet(promotion, previousOrder)
          && promotionRequirementsMet(promotion, order)
        ))
        .map((promotion) => promotion.id);
      celebratePromotionThresholds(newlyQualifiedPromotions);
    }
    setRegistrations((current) => [
      ...current.filter((existing) => existing.test_product_id || orderScopeKey(existing) !== scopeKey),
      ...(order ? [order] : []),
    ]);
    const pendingCode = couponCode.trim();

    if (
      !order
      || scopeKey !== selectedPromotionScope
      || !pendingCode
      || order.promotion_code?.toUpperCase() === pendingCode.toUpperCase()
    ) {
      return;
    }
    try {
      const preview = await shoppingApi.previewCurrentPromotion(pendingCode, activityId, scope.category_id);
      if (preview.eligible) {
        const updated = await shoppingApi.applyCurrentPromotion(pendingCode, activityId, scope.category_id);
        setRegistrations((current) => [
          ...current.filter((existing) => existing.test_product_id || orderScopeKey(existing) !== scopeKey),
          updated,
        ]);
        setPromotionFeedback(preview.reason ?? "優惠已套用。");
      } else {
        setPromotionFeedback(preview.reason ?? "商品已更新，優惠仍未達使用條件。");
      }
    } catch (error) {
      setPromotionFeedback(apiErrorMessage(error, "優惠檢查失敗"));
    }
  };

  const handleClassMemberRegistrationChange = (orders: OrderOut[]) => {
    refreshGeneration.current += 1;
    setRegistrations(orders);
    setClassMemberAccess("ready");
  };

  const leaveClassMemberMode = () => {
    setClassMemberUserId(null);
    setClassMemberName("");
    setClassMemberAccess("idle");
    setRegistrationLoadError(false);
    setRegistrations([]);
    const generation = ++refreshGeneration.current;
    if (isLoggedIn) {
      void shopApi.getCurrentRegistrations()
        .then((orders) => { if (generation === refreshGeneration.current) setRegistrations(orders); })
        .catch(() => { if (generation === refreshGeneration.current) setRegistrationLoadError(true); });
    }
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

  const catalogProducts = new Map(catalog.flatMap((category) => [
    ...category.products, ...category.series.flatMap((series) => series.products),
  ]).map((product) => [product.id, product]));
  const categoryPromotions = classMemberUserId ? [] : availablePromotions.filter((promotion) => (
    (promotion.activity_id ?? null) === (selectedCategory?.activity_id ?? null)
  ));
  const bundlePromotions = (classMemberUserId ? [] : availablePromotions).filter((promotion) => (
    promotion.discount_type === "bundle_price"
    && promotion.target_products?.some((target) => catalogProducts.has(target.id))
  ));
  const activeBundle = bundlePromotions.find((promotion) => promotion.id === activeBundleId);
  // 在目前商品尚未送出前，也能指出下一個待選品項。
  const nextBundleProduct = activeBundle && bundleProgress(activeBundle, catalogProducts,
    selectedCategoryRegistration).missing.find((target) => target.id !== openProduct);
  const selectBundleProduct = (promotion: ShopPromotionPublicOut, productId: string) => {
    const category = catalog.find((item) => item.products.some((product) => product.id === productId)
      || item.series.some((series) => series.products.some((product) => product.id === productId)));
    if (!category) return;
    setActiveBundleId(promotion.id);
    setSelectedPromotionScope(catalogScopeKey(category));
    if (promotion.code) setCouponCode(promotion.code);
    openPromotionProduct(productId);
  };
  const bundleHintFor = (product: CatalogProductOut) => {
    if (registrationLocked || registrationLoadError || closeStatus[selectedCategory?.id ?? ""]?.is_closed
      || !bundleProductAvailable(product)) return null;
    const savings = categoryPromotions.filter((promotion) => promotion.discount_type === "bundle_price")
      .map((promotion) => bundleProgress(promotion, catalogProducts, selectedCategoryRegistration))
      .filter((progress) => progress.started && !progress.unavailable
        && progress.missing.some((target) => target.id === product.id))
      .map((progress) => progress.saving ?? 0);
    if (!savings.length) return null;
    const saving = Math.max(...savings);
    return saving > 0 ? `加購可湊組 · 每套省 NT$${saving.toLocaleString()}` : "加購此商品可湊組";
  };
  const visibleProductCount = (
    (selectedSeriesId ? 0 : selectedCategory?.products.length ?? 0)
    + visibleSeries.reduce((count, series) => count + series.products.length, 0)
  );
  const delegationPanel = delegationToken && (
    <section className="shop-delegation-entry shop-delegation-context" aria-label="家長代訂">
      <div>
        <h2 ref={delegationReadyRef} tabIndex={-1}>{delegationContext ? `${delegationContext.link.name} · 為 ${delegationContext.student_name} 代訂` : "家長代訂"}</h2>
        {authLoading && <p role="status">確認登入帳號與代訂授權中…</p>}
        {!authLoading && isLoggedIn && <p className="shop-delegation-account">目前帳號：<strong>{currentAccount}</strong></p>}
        {delegationContext && <p className="shop-delegation-scope"><strong>授權範圍：{[...new Set((delegationContext.catalog ?? []).map((category) =>
          category.activity_name ?? category.name))].join("、") || "此連結的商品主題"}</strong>。本頁只顯示可代訂的商品。</p>}
        {delegationError && <p role="alert">{delegationError}</p>}
        {delegationContext?.can_claim && <>
          <p><strong>請先確認學生與登入帳號。</strong>確認後，這個連結只供目前帳號使用；若帳號不正確，請先登出並登入自己的帳號，再開啟原連結。</p>
        </>}
        {delegationContext?.can_edit && (
          <p role="status" className="shop-delegation-ready">
            {registrationLocked
              ? "本次預購已收款，品項不能再修改。可查看已登記品項。"
              : "已綁定此帳號，可在下方選購。送出後直接加入學生的預購。"}
          </p>
        )}
        {delegationContext?.can_edit && (
          <Link href="/shop/orders" className="shop-order-details">
            查看我的代訂訂單
          </Link>
        )}
        {(!delegationContext || delegationContext.can_claim || delegationContext.can_edit) && <>
          <p>送出即加入學生預購，不需學生再次確認，由學生繳款與領取。你只能修改此連結登記的品項，無法修改學生本人或其他家人的品項。</p>
          <p>確認綁定前，只能查看商品與學生姓名；確認後可查看此授權範圍的合計與品項。</p>
        </>}
        {delegationContext && !delegationContext.can_claim && (
          <section
            className="shop-delegation-registration"
            aria-labelledby="shop-delegation-registration-title"
          >
            <h3 id="shop-delegation-registration-title">學生在此活動的預購</h3>
            <p>學生本人和家人已登記的品項只供查看；你只能修改自己透過此連結加入的品項。</p>
            {delegatedRegistration?.items.length ? (
              <ul aria-label="學生本活動已登記品項">
                {delegatedRegistration.items.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.product_name ?? "商品"}</strong>
                      <span>{item.delegation_link_id
                        ? `${item.delegation_name ?? "家人代訂"} · ${item.ordered_by_name ?? "家人"}代訂`
                        : `${item.ordered_by_name ?? delegationContext.student_name}登記`}</span>
                      {item.selected_options.length > 0 && <span>
                        {item.selected_options.map((option) => `${option.group_name}：${option.value}`).join("、")}
                      </span>}
                    </div>
                    <strong>× {item.quantity} · NT${item.subtotal.toLocaleString("zh-TW")}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>目前尚無已登記品項。</p>
            )}
            {delegatedRegistration && (
              <Link
                href={`/shop/orders/${delegatedRegistration.id}`}
                className="shop-order-details"
              >
                查看訂單明細
              </Link>
            )}
          </section>
        )}
        {delegationContext?.can_claim && <>
          <button type="button" className="shop-delegation-primary" disabled={delegationBusy} onClick={async () => {
            setDelegationBusy(true);
            const context = await loadDelegation(delegationToken, true);
            if (context?.can_edit) {
              setDelegationOpen(false);
              window.requestAnimationFrame(() => delegationReadyRef.current?.focus());
            }
            setDelegationBusy(false);
          }}>{delegationBusy ? "確認中…" : "確認授權並開始代訂"}</button>
        </>}
        {!isLoggedIn && !authLoading && <Link
          className="shop-delegation-primary"
          href="/login?next=%2Fshop%3Fdelegation%3Dresume"
          onClick={() => shopDelegationLoginNext(delegationToken)}>登入自己的帳號開始代訂</Link>}
        {delegationError && isLoggedIn && <button type="button" onClick={() => void loadDelegation(delegationToken)}>重新載入</button>}
        {delegationContext && !delegationContext.can_claim && !delegationContext.can_edit && <p>這是你建立的連結。<Link href="/shop">返回本人商品頁</Link></p>}
        {!delegationOpen && !delegationContext?.can_edit && <button ref={delegationReopenRef} type="button"
          className="shop-delegation-primary" onClick={() => setDelegationOpen(true)}>重新開啟授權確認</button>}
        <DelegationInstructions />
      </div>
    </section>
  );

  return (
    <div className="shop-public-page">
      <header className="shop-public-hero">
        <div>
          <h1>商品預購</h1>
          <p className="shop-public-hero-copy">{classMemberUserId
            ? `班代調整${classMemberName || "指定同學"}的商品總量。`
            : delegationToken
              ? "使用學生授權的連結，替學生選購本次活動商品。"
              : "先選活動，再挑選商品與數量。"}</p>
        </div>
      </header>

      {!delegationToken && <div className="shop-mobile-shortcut-slot" ref={setShortcutSlot} />}

      {classMemberUserId && (
        <section className="shop-public-context" aria-label="班代調整對象">
          <UsersRound size={18} aria-hidden="true" />
          <div>
            <p><strong>調整對象：{classMemberName || "指定同學"}</strong></p>
            <p>商品數量會合併這位同學所有未鎖定訂購；已收款或鎖定的數量會保留。</p>
            {authLoading && <p role="status">正在確認登入與班級權限…</p>}
            {classMemberAccess === "loading" && <p role="status">正在載入同學的商品登記…</p>}
            {classMemberAccess === "error" && <p role="alert">無法讀取同學的商品登記，請返回班代頁重新選擇同學。</p>}
          </div>
          <Link href="/shop" className="shop-order-details" onClick={leaveClassMemberMode}>返回本人商品頁</Link>
        </section>
      )}

      {delegationToken && delegationOpen && !delegationContext?.can_edit && <Modal
        title="確認代訂授權" size="lg" onClose={closeDelegation}>
        <div className="public-site shop-delegation-panel">{delegationPanel}</div>
      </Modal>}
      {delegationToken && (!delegationOpen || delegationContext?.can_edit) && delegationPanel}

      {routeProductNotFound && !loading && (
        <div className="shop-public-alert" role="alert">
          <p>找不到這項商品，商品網址可能已失效。</p>
          <Link href="/shop">返回商品目錄</Link>
        </div>
      )}

      {myClass && (
        <section
          className="shop-public-context"
          aria-label="我的班級"
          data-closed={Object.values(closeStatus).some((status) => status.is_closed) || undefined}>
          {Object.values(closeStatus).some((status) => status.is_closed)
            ? <CircleAlert size={18} style={{ color: "var(--danger)" }} aria-hidden />
            : <CircleCheck size={18} style={{ color: "var(--success)" }} aria-hidden />}
          <div>
            <p>
              <strong>我的班級：{myClass.label ?? `${myClass.academic_year} 學年度 ${myClass.class_code} 班`}</strong>
              {" · "}
              {myClass.seat_number ? `座號：${myClass.seat_number} 號` : "座號尚未登錄"}
              {"。如有錯誤，請聯絡班聯會處理。"}
            </p>
          </div>
        </section>
      )}

      {isLoggedIn && isStudent && !delegationToken && !myClass && !loading && (
        <section className="shop-public-context" aria-label="我的班級">
          <CircleAlert size={18} aria-hidden />
          <div>
            {classLoadFailed ? (
              <div role="alert">
                <p>暫時無法確認你的班級與座號資料；如有錯誤，請聯絡班聯會處理。</p>
                <button type="button" className="shop-class-correction-toggle" onClick={loadCatalog}>重新確認班級</button>
              </div>
            ) : (
              <p>目前尚未顯示你的班級與座號；如有錯誤，請聯絡班聯會處理。</p>
            )}
          </div>
        </section>
      )}

      {!loading && !loadError && bundlePromotions.length > 0 && <section className="shop-bundles" aria-labelledby="shop-bundles-title">
        <div className="shop-bundles-heading">
          <h2 id="shop-bundles-title" tabIndex={-1}><Gift size={22} aria-hidden="true" />組合購買專區</h2>
          <p>一起選購享組合價；已登記其中一項，可直接加購湊組。</p>
        </div>
        <BundleCarousel>{bundlePromotions.map((promotion) => {
          const category = catalog.find((item) => [...item.products, ...item.series.flatMap((series) => series.products)]
            .some((product) => promotion.target_products?.some((target) => target.id === product.id)));
          const registration = category ? registrations.find((order) => !order.test_product_id && orderScopeKey(order) === catalogScopeKey(category)) ?? null : null;
          return <BundleOffer key={promotion.id} promotion={promotion} products={catalogProducts}
            scopeName={category?.activity_name ?? category?.name}
            registration={registration}
            disabled={authLoading || registrationLoadError || Boolean(registration?.is_paid || registration?.is_class_collected)
              || Boolean(delegationToken && !delegationContext?.can_edit)
              || Boolean(category && closeStatus[category.id]?.is_closed)}
            onSelect={(productId) => selectBundleProduct(promotion, productId)} />;
        })}</BundleCarousel>
      </section>}

      {promotionFeedback && <p className="shop-bundle-feedback" role="status" aria-live="polite">{promotionFeedback}</p>}
      {promotionCelebration && (
        <span key={promotionCelebration.token} className="sr-only" role="status" aria-live="polite">
          {availablePromotions
            .filter((promotion) => promotionCelebration.promotionIds.includes(promotion.id))
            .map((promotion) => promotion.name)
            .join("、")} 已達優惠使用門檻
        </span>
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
          <section className="shop-public-activity-picker" aria-labelledby="shop-activity-title">
            <div className="shop-public-activity-heading">
              <h2 id="shop-activity-title">選擇活動</h2>
              <p>商品登記會依活動分開，預設顯示仍可訂購的活動</p>
            </div>
            <nav className="shop-public-category-nav" aria-label="選擇商品活動">
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
                      setSelectedPromotionScope(catalogScopeKey(category));
                    }}
                    aria-pressed={isSelected}
                    className="shop-public-category-tab">
                    {category.name}
                    <span className="shop-public-category-count">
                      {categoryOrderable(category, catalogTime, closeStatus[category.id]?.is_closed) ? "訂購中" : "暫停訂購"} · {productCount} 件
                    </span>
                  </button>
                );
              })}
            </nav>
          </section>

          <section className="shop-public-catalog">
            <header className="shop-public-category-heading">
              <h2>{selectedCategory.name}</h2>
              <p>{visibleProductCount} 件商品</p>
            </header>
            {selectedCategory.order_closes_at && <p className="shop-public-product-deadline">
              活動結單：{new Date(selectedCategory.order_closes_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}（單品另設期限時以商品標示為準）
            </p>}
            {selectedCategoryRegistration && selectedCategoryRegistration.items.length > 0 && (
              <div className="shop-registration-price" role="status" aria-live="polite">
                <div><strong>目前登記合計</strong>
                  {selectedCategoryRegistration.discount_amount > 0 && <p>
                    {selectedCategoryRegistration.applied_promotions?.map((promotion) => promotion.name).join("、") || "已套用優惠"}
                    {` · 共省 NT$${selectedCategoryRegistration.discount_amount.toLocaleString()}`}
                  </p>}
                </div>
                <ShopPrice original={selectedCategoryRegistration.subtotal_price} current={selectedCategoryRegistration.total_price} />
              </div>
            )}
            {selectedCategory.series.length > 0 && (
              <div className="shop-public-series-filter-wrap">
                <span>商品系列</span>
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
              </div>
            )}
            {closeStatus[selectedCategory.id]?.is_closed && (
              <div className="shop-public-alert mt-6">
                <CircleAlert size={18} aria-hidden="true" />
                <p>
                  <strong>本班已停止訂購這個主題的商品</strong>
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
                  <div className={`shop-public-product-grid${selectedCategory.products.length === 1 ? " shop-public-product-grid--featured" : ""}`}>
                    {selectedCategory.products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        bundleHint={bundleHintFor(product)}
                        promotions={categoryPromotions}
                        products={catalogProducts}
                        offersLocked={registrationLocked || Boolean(classMemberUserId && classMemberAccess !== "ready")}
                        canAdjustRegistration={classMemberUserId
                          ? classMemberAccess === "ready"
                          : !registrationLocked && (delegationToken
                            ? Boolean(delegationContext?.can_edit)
                            : canOrderForSelf || product.status === "testing")}
                        onSelectBundle={(promotion) => selectBundleProduct(promotion, product.id)}
                        cardPrice={shopCardPrice(product, classMemberUserId ? [] : availablePromotions, selectedCategory.activity_id ?? null, selectedCategoryRegistration)}
                        classClosed={Boolean(closeStatus[selectedCategory.id]?.is_closed)}
                        registeredQuantity={registeredByProduct.get(product.id) ?? 0}
                        href={delegationToken || classMemberUserId ? null : shopProductHref(catalog, selectedCategory, product)}
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
                    <div className={`shop-public-product-grid${series.products.length === 1 ? " shop-public-product-grid--featured" : ""}`}>
                      {series.products.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          bundleHint={bundleHintFor(product)}
                          promotions={categoryPromotions}
                          products={catalogProducts}
                          offersLocked={registrationLocked || Boolean(classMemberUserId && classMemberAccess !== "ready")}
                          canAdjustRegistration={classMemberUserId
                            ? classMemberAccess === "ready"
                            : !registrationLocked && (delegationToken
                              ? Boolean(delegationContext?.can_edit)
                              : canOrderForSelf || product.status === "testing")}
                          onSelectBundle={(promotion) => selectBundleProduct(promotion, product.id)}
                          cardPrice={shopCardPrice(product, classMemberUserId ? [] : availablePromotions, selectedCategory.activity_id ?? null, selectedCategoryRegistration)}
                          classClosed={Boolean(closeStatus[selectedCategory.id]?.is_closed)}
                          registeredQuantity={registeredByProduct.get(product.id) ?? 0}
                          href={delegationToken || classMemberUserId ? null : shopProductHref(catalog, selectedCategory, product)}
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

      {!delegationToken && orderShortcutPortalReady && createPortal(
        <nav className="shop-public-shortcuts" aria-label="商品快捷操作">
          <button ref={delegationTriggerRef} type="button" className="shop-public-order-shortcut shop-public-delegation-shortcut"
            aria-haspopup="dialog" aria-expanded={delegationOpen} disabled={authLoading}
            onClick={() => setDelegationOpen(true)}>
            <UsersRound size={19} aria-hidden="true" />
            <span>{authLoading ? "確認身分中…" : "家人代訂"}</span>
          </button>
          {isLoggedIn && <Link
            href="/shop/orders"
            className="shop-public-order-shortcut"
            data-order-flight-target
            aria-label="開啟我的預購"
          >
            <ClipboardList size={19} aria-hidden="true" />
            <span>我的預購</span>
          </Link>}
        </nav>,
        compactShortcuts && shortcutSlot ? shortcutSlot : document.body,
      )}

      {delegationOpen && !delegationToken && <Modal title={isStudent ? "邀請家人代訂" : "代訂商品"} size="lg" onClose={closeDelegation}>
        <div className="public-site shop-delegation-panel">
          {authLoading ? <p role="status">正在確認帳號身分…</p> : isStudent ? <>
            <p className="shop-delegation-intro">建立一組驗證碼，讓家人用自己的帳號替你選購。</p>
            {catalog.length > 0 && <label className="shop-delegation-activity">選擇活動
              <select value={selectedCategory?.id ?? ""} onChange={(event) => setSelectedCategoryId(event.target.value)}>
                {catalog.map((category) => <option key={category.id} value={category.id}>
                  {category.activity_name ? `${category.activity_name} · ${category.name}` : category.name}
                </option>)}
              </select>
            </label>}
            {selectedCategory ? <DelegationLinks
              key={catalogScopeKey(selectedCategory)} initiallyCreating
              categoryId={selectedCategory.id} activityId={selectedCategory.activity_id ?? null}
              scopeName={selectedCategory.activity_name ?? selectedCategory.name} />
              : <>
                <h2>邀請家人幫我訂購</h2>
                <p>{loading ? "正在載入可授權的活動…" : loadError
                  ? "活動載入失敗，請重試後建立代訂連結。" : "目前沒有可授權的商品活動，開放預購後即可建立代訂連結。"}</p>
                {loadError && <button type="button" className="btn btn-secondary" onClick={() => void loadCatalog()}>重新載入活動</button>}
                <DelegationInstructions />
              </>}
          </> : <ParentDelegationEntry isLoggedIn={isLoggedIn} />}
        </div>
      </Modal>}

      {openProduct && (!delegationToken || delegationContext?.can_edit) && (
        <ProductModal
          productId={openProduct}
          promotions={classMemberUserId ? [] : availablePromotions}
          activityId={selectedCategory?.activity_id ?? null}
          bundleAddOn={(disabled) => <BundleAddOn productId={openProduct} promotions={categoryPromotions}
            products={catalogProducts} registration={selectedCategoryRegistration}
            disabled={disabled}
            onSelect={selectBundleProduct} />}
          bundleStep={activeBundle ? {
            name: activeBundle.name,
            nextLabel: nextBundleProduct ? `下一項：${nextBundleProduct.name}` : "完成套組選購",
            onContinue: () => {
              if (nextBundleProduct) openPromotionProduct(nextBundleProduct.id);
              else {
                setActiveBundleId(null);
                closeProduct();
                if (activeBundle.code && selectedCategory) void inspectAndApplyPromotion(activeBundle.code, catalogScopeKey(selectedCategory));
              }
            },
          } : undefined}
          shoppingApi={shoppingApi}
          classClosed={Boolean(closeStatus[selectedCategory?.id ?? ""]?.is_closed)}
          isLoggedIn={isLoggedIn}
          authLoading={authLoading}
          registrationLoadError={registrationLoadError || Boolean(classMemberUserId && classMemberAccess === "error")}
          registration={productRegistration ? {
            ...productRegistration,
            items: classMemberUserId
              ? productRegistration.items
              : productRegistration.items.filter((item) =>
                (item.delegation_link_id ?? null) === (delegationToken ? delegationContext?.link.id : null)),
          } : null}
          scopeKey={selectedCategory ? catalogScopeKey(selectedCategory) : GENERAL_ACTIVITY_SCOPE}
          registrationLocked={registrationLocked}
          authorizationRequired={classMemberUserId
            ? classMemberAccess === "idle" || classMemberAccess === "loading"
            : isLoggedIn && !canOrderForSelf && !testingProduct && !delegationToken}
          editingDescription={testingProduct
            ? "測試中：正式開放時會清除這項商品的試訂、付款／收款等紀錄，並回補庫存。"
            : classMemberUserId
            ? `正在調整${classMemberName || "指定同學"}跨所有未鎖定訂購的商品總量。已收款或鎖定的數量會保留。`
            : delegationToken
              ? `正在修改「${delegationContext?.link.name ?? "家人代訂"}」登記的數量。優惠按學生合計計算。`
            : selectedCategoryRegistration?.items.some((item) => item.delegation_link_id)
              ? "這裡修改本人登記的數量。家人代訂品項可在訂單明細修改；優惠按全部品項合計。"
              : undefined}
          productHref={classMemberUserId ? null : openProductHref}
          onClose={closeProduct}
          onRegistrationChange={handleRegistrationChange}
          onClassMemberRegistrationChange={handleClassMemberRegistrationChange}
          classMemberUserId={classMemberUserId}
          lockedVariantQuantities={lockedVariantQuantities}
          onProductAdded={flyProductIntoOrder}
          onRequestDelegation={() => { closeProduct(); setDelegationOpen(true); }}
        />
      )}
    </div>
  );
}
