"use client";
import TeacherPurchaseProfile from "@/components/shop/TeacherPurchaseProfile";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Gift,
  Package,
  UsersRound,
} from "lucide-react";
import { authApi, classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { ApiError } from "@/lib/api-helpers";
import { cacheGet, cacheSet } from "@/lib/api-cache";
import type {
  CatalogCategoryOut,
  CatalogProductOut,
  CloseStatusItem,
  MyClassContext,
  OrderOut,
  ShopPromotionPublicOut,
  ShopDelegationContextOut,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePersistedState } from "@/hooks/usePersistedState";
import { eligibleShopCatalog } from "@/lib/shop-catalog-visibility";
import { orderScopeKey, catalogScopeKey } from "@/lib/shop-order-scope";
import { refreshAutomaticRegistrationPromotions } from "@/lib/shop-registration-promotions";
import DelegationLinks from "@/components/shop/DelegationLinks";
import DelegationInstructions from "@/components/shop/DelegationInstructions";
import ParentDelegationEntry from "@/components/shop/ParentDelegationEntry";
import { readShopDelegationToken, shopDelegationLoginNext } from "@/lib/shop-delegation-link";
import { useWS } from "@/hooks/useWS";
import { useShopRegistration } from "@/hooks/useShopRegistration";
import Modal from "@/components/ui/Modal";
import { resolveShopProductPath, shopProductHref } from "@/lib/shop-product-url";
import { cleanupAnimatedElement, shouldAnimateProductFlight } from "@/lib/shop-product-flight";
import ShopPrice from "@/components/shop/ShopPrice";
import { registrationReferenceSubtotal } from "@/lib/shop-reference-price";
import BundleOffer from "@/components/shop/BundleOffer";
import BundleCarousel from "@/components/shop/BundleCarousel";
import BundleAddOn from "@/components/shop/BundleAddOn";
import TopicOffers from "@/components/shop/TopicOffers";
import { bundleProductAvailable, bundleProgress } from "@/lib/shop-bundle-progress";
import { shopCardPrice } from "@/lib/shop-card-price";
import { ProductCard } from "@/components/shop/ShopProductCard";
import { ProductModal, Thumb } from "@/components/shop/ShopProductModal";
import { OrderClosureNotice, resolveOrderClosureState } from "@/components/shop/ShopOrderClosure";
import { categoryOrderable, defaultShopCategory, productDeadline } from "@/lib/shop-deadlines";
import OrderItemGiftBreakdown from "@/components/shop/OrderItemGiftBreakdown";

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

const GENERAL_CATEGORY_SCOPE = "none";

type ShopPageProps = {
  topicSlug?: string;
  productSlug?: string;
};

type CatalogSnapshot = { scope: string; catalog: CatalogCategoryOut[] };

export default function ShopPage({ topicSlug, productSlug }: ShopPageProps = {}) {
  const router = useRouter();
  const directProductRoute = Boolean(topicSlug || productSlug);

  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [catalogTime, setCatalogTime] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [routeProductNotFound, setRouteProductNotFound] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const isLoggedInRef = useRef(false);
  const [isStudent, setIsStudent] = useState(false);
  const [canOrderForSelf, setCanOrderForSelf] = useState(false);
  const [currentAccount, setCurrentAccount] = useState("");
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const [delegationToken, setDelegationToken] = useState<string | null>(null);
  const [delegationContext, setDelegationContext] = useState<ShopDelegationContextOut | null>(null);
  const [delegationError, setDelegationError] = useState("");
  const [delegationBusy, setDelegationBusy] = useState(false);
  const refreshGeneration = useRef(0);
  const catalogRefresh = useRef<{ generation: number; key: string; promise: Promise<void> } | null>(null);
  const catalogLoaded = useRef<string | null>(null);
  const catalogScope = useRef<string | null>(null);
  const mutationBusy = useRef(false);
  const currentRegistrationRefresh = useRef<Promise<OrderOut[]> | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [registrationLoadError, setRegistrationLoadError] = useState(false);
  const [registrations, setRegistrations] = useState<OrderOut[]>([]);
  const [classMemberUserId, setClassMemberUserId] = useState<string | null>(null);
  const [classMemberName, setClassMemberName] = useState("");
  const [classMemberAccess, setClassMemberAccess] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [availablePromotions, setAvailablePromotions] = useState<ShopPromotionPublicOut[]>([]);
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [selectedPromotionScope, setSelectedPromotionScope] = useState(GENERAL_CATEGORY_SCOPE);
  const [promotionCelebration, setPromotionCelebration] = useState<{
    promotionIds: string[];
    token: number;
  } | null>(null);
  const promotionCelebrationToken = useRef(0);
  const promotionCelebrationTimer = useRef<number | null>(null);
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [classStatusLoading, setClassStatusLoading] = useState(false);
  const [myClass, setMyClass] = useState<MyClassContext | null>(null);
  const [classLoadFailed, setClassLoadFailed] = useState(false);
  const [orderShortcutPortalReady, setOrderShortcutPortalReady] = useState(false);
  const [shortcutSlot, setShortcutSlot] = useState<HTMLDivElement | null>(null);
  const [delegationOpen, setDelegationOpen] = useState(false);
  const delegationTriggerRef = useRef<HTMLButtonElement>(null);
  const delegationReopenRef = useRef<HTMLButtonElement>(null);
  const delegationReadyRef = useRef<HTMLHeadingElement>(null);
  const [selectedCategoryId, setSelectedCategoryId] = usePersistedState<string | null>("hcca:pref:shop:category:v1", null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  const loadCurrentRegistrations = useCallback(() => {
    if (currentRegistrationRefresh.current) return currentRegistrationRefresh.current;
    const refresh = shopApi.getCurrentRegistrations().then(refreshAutomaticRegistrationPromotions);
    currentRegistrationRefresh.current = refresh;
    void refresh.then(
      () => { if (currentRegistrationRefresh.current === refresh) currentRegistrationRefresh.current = null; },
      () => { if (currentRegistrationRefresh.current === refresh) currentRegistrationRefresh.current = null; },
    );
    return refresh;
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
    const memberId = new URLSearchParams(window.location.search).get("class_member_user_id") ?? undefined;
    const scope = catalogScope.current;
    const key = JSON.stringify([scope, directProductRoute, topicSlug, productSlug, memberId]);
    const cacheKey = `shop/catalog/${key}`;
    if (catalogRefresh.current?.generation === generation && catalogRefresh.current.key === key) {
      return catalogRefresh.current.promise;
    }
    if (catalogLoaded.current !== key) {
      const snapshot = scope ? cacheGet<CatalogSnapshot>(cacheKey) : undefined;
      if (snapshot?.scope === scope && Array.isArray(snapshot?.catalog)) {
        setCatalog(snapshot.catalog);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    setLoadError(false);
    const shouldLoadClassContext = isLoggedInRef.current;
    setClassStatusLoading(shouldLoadClassContext);
    const classContextRequest = shouldLoadClassContext
      ? Promise.resolve().then(() => classApi.myClass()).then(
        (schoolClass) => ({ schoolClass, failed: false }),
        () => ({ schoolClass: null, failed: true }),
      )
      : Promise.resolve({ schoolClass: null, failed: false });
    const routeSegments = topicSlug && productSlug
      ? [topicSlug, productSlug]
      : productSlug
        ? [productSlug]
        : undefined;
    const directPath = routeSegments?.map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const request = (memberId ? shopApi.catalog(undefined, false, directPath, memberId)
      : shopApi.catalog(undefined, false, directPath))
      .then(async (data) => {
        if (generation !== refreshGeneration.current || catalogRefresh.current?.promise !== request) return;
        catalogLoaded.current = key;
        setCatalog(data);
        if (scope) cacheSet(cacheKey, { scope, catalog: data } satisfies CatalogSnapshot);
        setLoading(false);
        try {
          const classContext = await classContextRequest;
          if (generation !== refreshGeneration.current || catalogRefresh.current?.promise !== request) return;
          if (classContext.failed) {
            setMyClass(null);
            setClassLoadFailed(true);
            return;
          }
          const schoolClass = classContext.schoolClass;
          setMyClass(schoolClass);
          setClassLoadFailed(false);
          if (schoolClass && data.length) {
            const catIds = data.map((c) => c.id);
            const status = await shopApi.getCloseStatus(catIds, schoolClass.id);
            if (generation !== refreshGeneration.current || catalogRefresh.current?.promise !== request) return;
            setCloseStatus(status.statuses);
          } else {
            setCloseStatus({});
          }
        } catch {
          if (generation === refreshGeneration.current && catalogRefresh.current?.promise === request) {
            setMyClass(null);
            setClassLoadFailed(true);
          }
        }
      })
      .catch(() => {
        if (generation === refreshGeneration.current && catalogRefresh.current?.promise === request) setLoadError(true);
      })
      .finally(() => {
        if (catalogRefresh.current?.promise === request) {
          catalogRefresh.current = null;
          if (generation === refreshGeneration.current) {
            setLoading(false);
            setClassStatusLoading(false);
          }
        }
      });
    catalogRefresh.current = { generation, key, promise: request };
    return request;
  }, [directProductRoute, productSlug, topicSlug]);

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

  useEffect(() => {
    let active = true;
    const token = readShopDelegationToken();
    setDelegationToken(token);
    setDelegationOpen((alreadyOpen) => alreadyOpen || Boolean(token));
    const loadShop = () => {
      loadCatalog();
      const generation = refreshGeneration.current;
      void shopApi.listAvailablePromotions()
        .then((promotions) => { if (active && generation === refreshGeneration.current) setAvailablePromotions(promotions); })
        .catch(() => { if (active && generation === refreshGeneration.current) setAvailablePromotions([]); });
    };
    if (token) {
      setCatalog([]);
      setLoading(true);
    }
    void authApi.refresh().then(async (user) => {
      if (!active) return;
      catalogScope.current = `user:${user.id}`;
      isLoggedInRef.current = true;
      setIsLoggedIn(true);
      setIsStudent(user.can_create_shop_delegation ?? Boolean(user.student_id));
      setCanOrderForSelf(Boolean(user.can_create_shop_delegation || user.student_id || user.is_school_email));
      setCurrentAccount(`${user.display_name}（${user.email}）`);
      setUserRoom(`user:${user.id}`);
      const currentToken = readShopDelegationToken();
      setDelegationToken(currentToken);
      if (currentToken) {
        await loadDelegation(currentToken);
      } else {
        // 公開目錄不會以 401 觸發刷新，必須先確認登入才能取得測試商品。
        loadShop();
        if (!new URLSearchParams(window.location.search).get("class_member_user_id")) {
          const generation = refreshGeneration.current;
          try {
            const orders = await loadCurrentRegistrations();
            if (active && generation === refreshGeneration.current) setRegistrations(orders);
          }
          catch (error) {
            if (!active || generation !== refreshGeneration.current) return;
            setRegistrationLoadError(true);
            toast.error(apiErrorMessage(error, "無法載入商品登記"));
          }
        }
      }
    }).catch((error: unknown) => {
      if (!active) return;
      // Never reuse a previous identity's catalog while the auth service is unavailable.
      catalogScope.current = error instanceof ApiError && error.status === 401 ? "public" : null;
      isLoggedInRef.current = false;
      setIsLoggedIn(false);
      setRegistrations([]);
      if (token) setLoading(false);
      else loadShop();
    }).finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [loadCatalog, loadDelegation, loadCurrentRegistrations]);

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
      setClassStatusLoading(false);
      const loggedIn = isLoggedInRef.current;
      if (token) {
        setCatalog([]);
        setLoading(loggedIn);
        if (loggedIn) void loadDelegation(token);
      } else {
        loadCatalog();
        const generation = refreshGeneration.current;
        void shopApi.listAvailablePromotions()
          .then((promotions) => { if (generation === refreshGeneration.current) setAvailablePromotions(promotions); })
          .catch(() => { if (generation === refreshGeneration.current) setAvailablePromotions([]); });
        if (loggedIn && classMemberId && classMemberId === classMemberUserId) {
          void loadClassMemberOrders(classMemberId, true);
        } else if (loggedIn && !classMemberId) {
          void loadCurrentRegistrations()
            .then((orders) => { if (generation === refreshGeneration.current) setRegistrations(orders); })
            .catch(() => { if (generation === refreshGeneration.current) setRegistrationLoadError(true); });
        }
      }
    };
    window.addEventListener("hashchange", changeContext);
    return () => window.removeEventListener("hashchange", changeContext);
  }, [isLoggedIn, delegationToken, classMemberUserId, loadCatalog, loadDelegation, loadClassMemberOrders, loadCurrentRegistrations]);

  useEffect(() => {
    if (authLoading || delegationToken) return;
    const refresh = () => {
      if (!mutationBusy.current && document.visibilityState !== "hidden") void loadCatalog();
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authLoading, delegationToken, loadCatalog]);

  const refreshRegistrations = useCallback(async () => {
    if (!isLoggedIn || authLoading || mutationBusy.current || document.visibilityState === "hidden") return;
    if (delegationToken) {
      await loadDelegation(delegationToken);
    } else if (classMemberUserId) {
      await loadClassMemberOrders(classMemberUserId);
    } else {
      const generation = refreshGeneration.current;
      try {
        const orders = await loadCurrentRegistrations();
        if (generation === refreshGeneration.current) setRegistrations(orders);
      } catch { /* 保留已載入內容；下一次同步重試。 */ }
    }
  }, [isLoggedIn, authLoading, delegationToken, classMemberUserId, loadDelegation, loadClassMemberOrders, loadCurrentRegistrations]);
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

  const routeProductEntry = useMemo(() => (
    productSlug
      ? resolveShopProductPath(catalog, topicSlug ? [topicSlug, productSlug] : [productSlug])
      : null
  ), [catalog, productSlug, topicSlug]);

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

    const entry = productId
      ? catalog.flatMap((category) => [
          ...category.products.map((product) => ({ category, product })),
          ...category.series.flatMap((series) => series.products.map((product) => ({ category, product }))),
        ]).find(({ product }) => product.id === productId) ?? null
      : routeProductEntry;
    if (!entry) {
      setRouteProductNotFound(Boolean(productSlug));
      return;
    }

    setRouteProductNotFound(false);
    setSelectedCategoryId(entry.category.id);
    setSelectedSeriesId(null);
    setOpenProduct(entry.product.id);
  }, [catalog, loading, productSlug, routeProductEntry, setSelectedCategoryId]);

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

  const visibleCatalog = useMemo(() => eligibleShopCatalog(classMemberUserId ? catalog.map((category) => {
    const registered = new Set(registrations.flatMap((order) => order.items.map((item) => item.product_id)));
    const products = (items: typeof category.products) => items.map((product) => registered.has(product.id)
      ? { ...product, purchase_allowed: true } : product);
    return { ...category, products: products(category.products),
      series: category.series.map((series) => ({ ...series, products: products(series.products) })) };
  }) : catalog, new Set(registrations.filter((order) => order.status !== "cancelled")
    .flatMap((order) => order.items.filter((item) => item.quantity > 0).map((item) => item.product_id)))),
  [catalog, classMemberUserId, registrations]);
  const displayedCatalog = directProductRoute && routeProductEntry
    ? visibleCatalog.filter((category) => category.id === routeProductEntry.category.id)
    : directProductRoute
      ? visibleCatalog
      : visibleCatalog.filter((category) => (
        !category.order_closed_at
        && !(closeStatus[category.id]?.is_closed && closeStatus[category.id]?.is_global)
      ));
  const openProductDisplayed = !loading && displayedCatalog.some((category) => (
    category.products.some((product) => product.id === openProduct)
    || category.series.some((series) => series.products.some((product) => product.id === openProduct))
  ));
  const selectedCategory = directProductRoute
    ? displayedCatalog.find((category) => category.id === routeProductEntry?.category.id) ?? null
    : displayedCatalog.find((category) => category.id === selectedCategoryId)
      ?? displayedCatalog[0]
      ?? null;
  const selectedCategoryCloseStatus = selectedCategory
    ? closeStatus[selectedCategory.id]
    : undefined;
  const selectedCategoryClosure = resolveOrderClosureState(
    selectedCategoryCloseStatus,
    selectedCategory?.order_closed_at ?? null,
    catalogTime,
  );
  const directLinkClosed = directProductRoute && selectedCategoryClosure.isClosed
    && (selectedCategoryClosure.councilClosed || selectedCategoryClosure.deadlinePassed
      || routeProductEntry?.product.status !== "testing");

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

  const selectedCategoryScope = selectedCategory ? catalogScopeKey(selectedCategory) : "none";
  const delegatedRegistration = delegationContext ? registrations[0] ?? null : null;
  const testingProduct = catalog.flatMap((category) => [
    ...category.products, ...category.series.flatMap((series) => series.products),
  ]).some((product) => product.id === openProduct && product.status === "testing");
  const {
    scopeRegistration: selectedCategoryRegistration,
    scopeTotalRegistration: selectedCategoryTotals,
    registration: productRegistration,
    lockedVariantQuantities,
    registrationLocked,
    getProduct,
    saveVariant,
    applyPromotion: inspectAndApplyPromotion,
    promotionFeedback,
  } = useShopRegistration({
    delegationToken, delegationContext, classMemberUserId,
    classMemberReady: classMemberAccess === "ready",
    isLoggedIn, authLoading, canOrderForSelf,
    registrations, setRegistrations,
    scopeKey: selectedCategoryScope, productId: openProduct, testingProduct,
    availablePromotions, couponCode, selectedPromotionScope,
    refreshGeneration, mutationBusy,
    onClassMemberReady: () => setClassMemberAccess("ready"),
    onQualifiedPromotions: celebratePromotionThresholds,
  });
  const registeredByProduct = new Map<string, number>();
  for (const item of registrations.filter((order) => orderScopeKey(order) === selectedCategoryScope).flatMap((order) => order.items)) {
    registeredByProduct.set(
      item.product_id,
      (registeredByProduct.get(item.product_id) ?? 0) + item.quantity,
    );
  }
  const leaveClassMemberMode = () => {
    setClassMemberUserId(null);
    setClassMemberName("");
    setClassMemberAccess("idle");
    setRegistrationLoadError(false);
    setRegistrations([]);
    const generation = ++refreshGeneration.current;
    if (isLoggedIn) {
      void loadCurrentRegistrations()
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

  const catalogProducts = new Map(visibleCatalog.flatMap((category) => [
    ...category.products, ...category.series.flatMap((series) => series.products),
  ]).map((product) => [product.id, product]));
  const referenceSubtotal = selectedCategoryTotals
    ? registrationReferenceSubtotal(selectedCategoryTotals.items, catalogProducts) : 0;
  const totalSaving = referenceSubtotal - (selectedCategoryTotals?.total_price ?? 0);
  const catalogCategoryByProductId = new Map(visibleCatalog.flatMap((category) => [
    ...category.products.map((product) => [product.id, category] as const),
    ...category.series.flatMap((series) => series.products.map((product) => [product.id, category] as const)),
  ]));
  const categoryScopeKey = (category: CatalogCategoryOut) => catalogScopeKey(category);
  const selectedTargetCategoryScope = selectedCategory ? categoryScopeKey(selectedCategory) : null;
  const categoryPromotions = classMemberUserId || !selectedCategory ? [] : availablePromotions.filter((promotion) => {
    if (promotion.target_category_ids?.length
      && !promotion.target_category_ids.includes(selectedCategory.id)) return false;
    const targets = promotion.target_products ?? [];
    if (targets.some((target) => !catalogProducts.has(target.id))) return false;
    const targetScopes = new Set(targets.flatMap((target) => {
      const category = catalogCategoryByProductId.get(target.id);
      return category ? [categoryScopeKey(category)] : [];
    }));
    if (targetScopes.size > 1) return false;

    const [targetScope] = targetScopes;
    return !targetScope || targetScope === selectedTargetCategoryScope;
  });
  const bundlePromotions = categoryPromotions.filter((promotion) => (
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
        {delegationContext && <p className="shop-delegation-scope"><strong>授權分類：{[...new Set((delegationContext.catalog ?? []).map((category) => category.name))].join("、") || "商品分類"}</strong>。本頁只顯示可代訂的商品。</p>}
        {delegationError && <p role="alert">{delegationError}</p>}
        {delegationContext?.can_claim && <>
          <p><strong>請先確認學生與登入帳號。</strong>綁定後僅限目前帳號使用；帳號有誤請先重新登入。</p>
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
          <p>送出即加入學生預購，由學生繳款與領取。</p>
          <p>確認後可查看授權範圍的合計與品項。</p>
        </>}
        {delegationContext && !delegationContext.can_claim && (
          <section
            className="shop-delegation-registration"
            aria-labelledby="shop-delegation-registration-title"
          >
            <h3 id="shop-delegation-registration-title">學生在此商品分類的預購</h3>
            <p>僅可修改此連結登記的品項。</p>
            {delegatedRegistration?.items.length ? (
              <ul aria-label="學生本商品分類已登記品項">
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
                    <OrderItemGiftBreakdown items={[item]} />
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
          {classMemberUserId && <p className="shop-public-hero-copy">
            班代調整{classMemberName || "指定同學"}的商品總量。
          </p>}
        </div>
        {!delegationToken && <div className="shop-mobile-shortcut-slot" ref={setShortcutSlot} />}
      </header>

      {isLoggedIn && !isStudent && !delegationToken && !classMemberUserId && <TeacherPurchaseProfile />}

      {classMemberUserId && (
        <section className="shop-public-context" aria-label="班代調整對象">
          <UsersRound size={18} aria-hidden="true" />
          <div>
            <p><strong>調整對象：{classMemberName || "指定同學"}</strong></p>
            <p>已收款或鎖定的數量不會變動。</p>
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
        <details
          className="shop-class-summary"
          aria-label="我的班級">
          <summary>
            <span>我的班級：{myClass.label ?? `${myClass.academic_year} 學年度 ${myClass.class_code} 班`}
              {myClass.seat_number ? ` · ${myClass.seat_number} 號` : " · 座號尚未登錄"}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="shop-public-context">
            <CircleCheck size={18} style={{ color: "var(--success)" }} aria-hidden />
            <div>
              <p>
                <strong>我的班級：{myClass.label ?? `${myClass.academic_year} 學年度 ${myClass.class_code} 班`}</strong>
                {" · "}
                {myClass.seat_number ? `座號：${myClass.seat_number} 號` : "座號尚未登錄"}
                {"。如有錯誤，請聯絡班聯會處理。"}
              </p>
            </div>
          </div>
        </details>
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
      ) : loadError && displayedCatalog.length === 0 ? null : displayedCatalog.length === 0 ? (
        <div className="shop-public-empty">
          <Package className="mx-auto" size={36} strokeWidth={1.2} aria-hidden="true" />
          <p>目前沒有可訂購的商品，請稍後再來看看。</p>
        </div>
      ) : selectedCategory && (
        directLinkClosed ? (
          <section className="shop-public-closed-page" aria-label="商品分類結單通知" role="status">
            <CircleAlert size={22} aria-hidden="true" />
            <div>
              <h2>{selectedCategoryClosure.councilClosed
                ? "班聯已結單"
                : selectedCategoryClosure.classPaid
                  ? "班聯已確認本班收款"
                  : "商品分類已結單"}</h2>
              <p>{selectedCategoryClosure.councilClosed
                ? "此商品分類已從公開目錄隱藏。這個舊連結僅供查看商品詳情與收款紀錄，無法訂購。"
                : selectedCategoryClosure.classPaid
                  ? "本班此商品分類已完成收款確認，暫停登記；其他班級與本班其他商品分類仍可訂購。"
                  : "此商品分類已停止登記。這個舊連結僅供查看商品詳情與收款紀錄，無法訂購。"}</p>
            </div>
          </section>
        ) : <div>
          {displayedCatalog.length > 1 && <section className="shop-public-category-picker" aria-labelledby="shop-category-title">
            <div className="shop-public-category-picker-heading">
              <h2 id="shop-category-title">選擇商品分類</h2>
            </div>
            <nav className="shop-public-category-nav" aria-label="選擇商品分類">
              {displayedCatalog.map((category) => {
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
                    <span className="shop-public-category-count">{productCount}</span>
                    {!categoryOrderable(category, catalogTime, closeStatus[category.id]?.is_closed) && <span className="shop-public-category-count">暫停訂購</span>}
                  </button>
                );
              })}
            </nav>
          </section>}

          <section className="shop-public-catalog">
            <header className="shop-public-category-heading">
              <h2>{selectedCategory.name}</h2>
              <p>{visibleProductCount} 件商品</p>
            </header>
            <TopicOffers key={selectedCategory.id} promotions={categoryPromotions} />
            {bundlePromotions.length > 0 && <section className="shop-bundles" aria-labelledby="shop-bundles-title">
              <div className="shop-bundles-heading">
                <h2 id="shop-bundles-title" tabIndex={-1}><Gift size={18} aria-hidden="true" />一起買更划算</h2>
                <p>選購優惠套組</p>
              </div>
              <BundleCarousel key={selectedCategory.id}>
                {bundlePromotions.map((promotion) => <BundleOffer key={promotion.id}
                  promotion={promotion} promotions={bundlePromotions}
                  products={catalogProducts} registration={selectedCategoryRegistration}
                  disabled={authLoading || registrationLoadError || registrationLocked
                    || Boolean(closeStatus[selectedCategory.id]?.is_closed)}
                  onSelect={(productId) => selectBundleProduct(promotion, productId)} />)}
              </BundleCarousel>
            </section>}
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
            <OrderClosureNotice
              status={selectedCategoryCloseStatus}
              categoryClosedAt={selectedCategory.order_closed_at ?? null}
            />
            <div id="shop-product-selection" className="shop-public-series-list" tabIndex={-1}>
              {!selectedSeriesId && selectedCategory.products.length > 0 && (
                <section className="shop-public-series">
                  <div className={`shop-public-product-grid${selectedCategory.products.length === 1 ? " shop-public-product-grid--featured" : ""}`}>
                    {selectedCategory.products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        featured={selectedCategory.products.length === 1}
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
                        cardPrice={shopCardPrice(product, categoryPromotions, selectedCategoryRegistration, selectedCategory.id)}
                        classClosed={Boolean(closeStatus[selectedCategory.id]?.is_closed && !closeStatus[selectedCategory.id]?.is_global)}
                        councilClosed={Boolean(closeStatus[selectedCategory.id]?.is_global)}
                        registeredQuantity={registeredByProduct.get(product.id) ?? 0}
                        href={delegationToken || classMemberUserId ? null : shopProductHref(catalog,
                          catalog.find((category) => category.id === selectedCategory.id) ?? selectedCategory, product)}
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
                          cardPrice={shopCardPrice(product, categoryPromotions, selectedCategoryRegistration, selectedCategory.id)}
                          classClosed={Boolean(closeStatus[selectedCategory.id]?.is_closed && !closeStatus[selectedCategory.id]?.is_global)}
                          councilClosed={Boolean(closeStatus[selectedCategory.id]?.is_global)}
                          registeredQuantity={registeredByProduct.get(product.id) ?? 0}
                          href={delegationToken || classMemberUserId ? null : shopProductHref(catalog,
                            catalog.find((category) => category.id === selectedCategory.id) ?? selectedCategory, product)}
                          onClick={() => setOpenProduct(product.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
            {selectedCategoryTotals && selectedCategoryTotals.items.length > 0 && (
              <div className="shop-registration-price" role="status" aria-live="polite">
                <div><strong>目前登記合計</strong>
                  {totalSaving > 0 && <p>
                    {selectedCategoryTotals.applied_promotions?.map((promotion) => promotion.name).join("、") || "商品與規格優惠"}
                    {` · 共省 NT$${totalSaving.toLocaleString()}`}
                  </p>}
                </div>
                <ShopPrice original={referenceSubtotal} current={selectedCategoryTotals.total_price} />
              </div>
            )}
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
        shortcutSlot ?? document.body,
      )}

      {delegationOpen && !delegationToken && <Modal title={isStudent ? "邀請家人代訂" : "代訂商品"} size="lg" onClose={closeDelegation}>
        <div className="public-site shop-delegation-panel">
          {authLoading ? <p role="status">正在確認帳號身分…</p> : isStudent ? <>
            <p className="shop-delegation-intro">建立一組驗證碼，讓家人用自己的帳號替你選購。</p>
            {catalog.length > 0 && <label className="shop-delegation-activity">商品分類
              <select value={selectedCategory?.id ?? ""} onChange={(event) => setSelectedCategoryId(event.target.value)}>
                {catalog.map((category) => <option key={category.id} value={category.id}>
                  {category.name}
                </option>)}
              </select>
            </label>}
            {selectedCategory ? <DelegationLinks
              key={catalogScopeKey(selectedCategory)} initiallyCreating
              categoryId={selectedCategory.id} scopeName={selectedCategory.name} />
              : <>
                <h2>邀請家人幫我訂購</h2>
                <p>{loading ? "正在載入商品分類…" : loadError
                  ? "商品分類載入失敗，請重試後建立代訂連結。" : "目前沒有可授權的商品分類，開放預購後即可建立代訂連結。"}</p>
                {loadError && <button type="button" className="btn btn-secondary" onClick={() => void loadCatalog()}>重新載入商品分類</button>}
                <DelegationInstructions />
              </>}
          </> : <ParentDelegationEntry isLoggedIn={isLoggedIn} />}
        </div>
      </Modal>}

      {openProduct && openProductDisplayed && (!delegationToken || delegationContext?.can_edit) && (
        <ProductModal
          productId={openProduct}
          promotions={categoryPromotions}
          categoryId={selectedCategory?.id ?? null}
          bundleAddOn={(disabled) => <BundleAddOn productId={openProduct} promotions={categoryPromotions}
            products={catalogProducts} registration={selectedCategoryRegistration}
            disabled={disabled}
            onSelect={selectBundleProduct} />}
          bundleStep={activeBundle ? {
            name: activeBundle.name,
            position: (activeBundle.target_products?.findIndex((target) => target.id === openProduct) ?? 0) + 1,
            total: activeBundle.target_products?.length ?? 0,
            nextLabel: nextBundleProduct ? `儲存並選下一項：${nextBundleProduct.name}` : "儲存並完成套組",
            onContinue: () => {
              if (nextBundleProduct) openPromotionProduct(nextBundleProduct.id);
              else {
                setActiveBundleId(null);
                closeProduct();
                if (activeBundle.code && selectedCategory) void inspectAndApplyPromotion(activeBundle.code, catalogScopeKey(selectedCategory));
              }
            },
          } : undefined}
          getProduct={getProduct}
          saveVariant={saveVariant}
          closeStatus={selectedCategory ? closeStatus[selectedCategory.id] : undefined}
          categoryClosedAt={selectedCategory?.order_closed_at ?? null}
          isLoggedIn={isLoggedIn}
          authLoading={authLoading}
          classStatusLoading={classStatusLoading}
          registrationLoadError={registrationLoadError || classLoadFailed || loadError || Boolean(classMemberUserId && classMemberAccess === "error")}
          registration={productRegistration}
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
          adjustingClassMember={Boolean(classMemberUserId)}
          lockedVariantQuantities={lockedVariantQuantities}
          onProductAdded={flyProductIntoOrder}
          onRequestDelegation={() => { closeProduct(); setDelegationOpen(true); }}
        />
      )}
    </div>
  );
}
