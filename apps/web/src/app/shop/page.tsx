"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Link from "next/link";
import { Package, ShoppingBag } from "lucide-react";
import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type { CatalogCategoryOut, CatalogProductOut, CloseStatusItem, ProductOut } from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { usePersistedState } from "@/hooks/usePersistedState";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";

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
      className="rounded-lg object-cover flex-shrink-0"
      style={{ width: size, height: size, border: "1px solid var(--border)" }}
    />
  );
}

// ── 商品變體選購 Modal ────────────────────────────────────────────────────────

function ProductModal({
  productId,
  onClose,
  onAdded,
}: {
  productId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [product, setProduct] = useState<ProductOut | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    shopApi
      .getProduct(productId)
      .then(setProduct)
      .catch((e) => toast.error(apiErrorMessage(e, "載入商品失敗")));
  }, [productId]);

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

  if (!product || !mounted) return null;

  const delta = product.variant_groups.reduce((sum, g) => {
    const opt = g.options.find((o) => o.id === picked[g.id]);
    return sum + (opt?.price_delta ?? 0);
  }, 0);
  const unitPrice = product.price + delta;
  const allPicked = product.variant_groups.every((g) => picked[g.id]);
  const available =
    product.status === "active" && (product.is_unlimited || product.stock_quantity > 0);
  const displayImage = product.variant_groups.reduce((current, group) => {
    const option = group.options.find((o) => o.id === picked[group.id]);
    return option?.image_url || current;
  }, product.image_url);

  const submit = async () => {
    if (!allPicked) {
      toast.error("請選擇所有規格");
      return;
    }
    setLoading(true);
    try {
      await shopApi.addCartItem({
        product_id: product.id,
        quantity: qty,
        option_ids: Object.values(picked),
      });
      toast.success("已加入購物車");
      onAdded();
    } catch (e) {
      toast.error(apiErrorMessage(e, "加入失敗"));
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid min-h-dvh place-items-center overflow-y-auto p-4"
      style={{ background: "var(--bg-overlay)" }}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
        tabIndex={-1}
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto card p-6 space-y-4 animate-scale-in"
        style={{ boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-start gap-4">
          <Thumb url={displayImage} alt={product.name} size={88} />
          <div className="flex-1 min-w-0">
            <h3 id="product-modal-title" className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {product.name}
            </h3>
            {product.description && (
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {product.description}
              </p>
            )}
            <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
              {product.is_unlimited ? "無限量" : `庫存 ${product.stock_quantity} 件`}
            </p>
          </div>
          <button ref={closeButtonRef} onClick={onClose} className="topbar-icon-btn" aria-label="關閉">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 變體選擇 */}
        {product.variant_groups.map((g) => (
          <div key={g.id}>
            <label className="text-xs font-medium block mb-2" style={{ color: "var(--text-secondary)" }}>
              {g.name}
            </label>
            <div className="flex flex-wrap gap-2">
              {g.options
                .filter((o) => o.is_active)
                .map((o) => {
                  const sel = picked[g.id] === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => setPicked((p) => ({ ...p, [g.id]: o.id }))}
                      className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm"
                      aria-pressed={sel}
                      style={{
                        border: sel ? "1.5px solid var(--primary)" : "1px solid var(--border)",
                        background: sel ? "var(--primary-soft, var(--bg-elevated))" : "var(--bg)",
                        color: "var(--text-primary)",
                      }}>
                      {o.image_url && <Thumb url={o.image_url} alt={o.value} size={28} />}
                      <span>{o.value}</span>
                      {o.price_delta !== 0 && (
                        <span style={{ color: "var(--primary)" }}>
                          {o.price_delta > 0 ? `+${o.price_delta}` : o.price_delta}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}

        {/* 數量 */}
        <div>
          <label className="text-xs font-medium block mb-2" style={{ color: "var(--text-secondary)" }}>
            數量
          </label>
          <div className="flex items-center gap-3">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="btn btn-ghost h-11 w-11 p-0" aria-label="減少數量">−</button>
            <span className="text-base font-semibold w-8 text-center" style={{ color: "var(--text-primary)" }}>
              {qty}
            </span>
            <button
              onClick={() => setQty((q) =>
                product.is_unlimited ? q + 1 : Math.min(product.stock_quantity, q + 1))}
              className="btn btn-ghost h-11 w-11 p-0" aria-label="增加數量">＋</button>
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={submit}
            disabled={loading || !available}
            className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}
            aria-busy={loading}>
            {!available
              ? "無法購買"
              : loading
                ? "處理中…"
                : `加入購物車 NT$${(unitPrice * qty).toLocaleString()}`}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 商品卡片 ──────────────────────────────────────────────────────────────────

function ProductCard({ product, onClick }: { product: CatalogProductOut; onClick: () => void }) {
  const soldOut = product.status === "sold_out";
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-xl border text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5"
      style={{
        opacity: soldOut ? 0.6 : 1,
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
      aria-label={`查看商品：${product.name}`}>
      <div className="relative aspect-[4/5] w-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={uploadUrl(product.image_url)}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ color: "var(--text-disabled)" }}>
            <Package size={34} strokeWidth={1.35} aria-hidden="true" />
          </div>
        )}
        <span
          className="absolute left-3 top-3 rounded-md px-2 py-1 text-xs font-medium"
          style={{
            background: soldOut ? "var(--bg-elevated)" : "var(--primary-dim)",
            color: soldOut ? "var(--text-secondary)" : "var(--primary-text)",
          }}>
          {soldOut ? "已售完" : product.is_unlimited ? "供應中" : `剩 ${product.stock_quantity}`}
        </span>
      </div>
      <div className="space-y-2 px-3.5 py-3.5">
        <h3 className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {product.name}
        </h3>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-bold tracking-tight" style={{ color: "var(--primary-text)" }}>
            NT${product.price.toLocaleString()}
            {product.has_variants && (
              <span className="text-xs font-normal ml-1" style={{ color: "var(--text-muted)" }}>起</span>
            )}
          </span>
        </div>
        {product.sale_end && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            截止 {new Date(product.sale_end).toLocaleString("zh-TW")}
          </p>
        )}
      </div>
    </button>
  );
}

// ── 購買頁 ────────────────────────────────────────────────────────────────────

export default function ShopPage() {
  const activityId = useSearchParams().get("activity_id") || undefined;
  const catalogCacheKey = `shop/catalog/${activityId ?? "all"}`;

  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>(() => cacheGet<CatalogCategoryOut[]>(catalogCacheKey) ?? []);
  const [loading, setLoading] = useState(!cacheHas(catalogCacheKey));
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [selectedCategoryId, setSelectedCategoryId] = usePersistedState<string | null>("hcca:pref:shop:category:v1", null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  const loadCatalog = useCallback(() => {
    if (!cacheHas(catalogCacheKey)) setLoading(true);
    shopApi
      .catalog(activityId)
      .then(async (data) => {
        setCatalog(data);
        cacheSet(catalogCacheKey, data);
        setSelectedCategoryId((current) => current ?? data[0]?.id ?? null);
        try {
          const schoolClass = await classApi.myClass();
          if (schoolClass && data.length) {
            const catIds = data.map((c) => c.id);
            const status = await shopApi.getCloseStatus(catIds, schoolClass.id);
            setCloseStatus(status.statuses);
          }
        } catch { /* best effort */ }
      })
      .catch((e) => toast.error(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, [setSelectedCategoryId, activityId, catalogCacheKey]);

  const loadCart = useCallback(() => {
    shopApi
      .getCart()
      .then((c) => setCartCount(c.items.reduce((n, i) => n + i.quantity, 0)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadCatalog();
    loadCart();
  }, [loadCatalog, loadCart]);

  const selectedCategory =
    catalog.find((category) => category.id === selectedCategoryId) ?? catalog[0] ?? null;

  const visibleSeries = selectedCategory?.series.filter(
    (series) => !selectedSeriesId || series.id === selectedSeriesId,
  ) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div className="workspace-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>商品訂購</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            選好想要的商品，統一在購物車確認送單。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/shop/orders" className="btn btn-ghost">我的訂單</Link>
          <Link
            href="/shop/cart"
            className="btn inline-flex items-center gap-2"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            <ShoppingBag size={16} aria-hidden="true" />
            購物車{cartCount > 0 ? `（${cartCount}）` : ""}
          </Link>
        </div>
      </div>

      {loading ? (
        <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
      ) : catalog.length === 0 ? (
        <SmartEmptyState reason="none" subject="上架商品" message="店家還沒上架任何商品，請稍後再來看看" />
      ) : selectedCategory && (
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <p className="mb-3 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>選擇主題</p>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1.5 lg:overflow-visible">
              {catalog.map((category) => {
                const isSelected = category.id === selectedCategory.id;
                return (
                  <button
                    key={category.id}
                    onClick={() => {
                      setSelectedCategoryId(category.id);
                      setSelectedSeriesId(null);
                    }}
                    aria-pressed={isSelected}
                    className="flex min-w-44 items-center gap-3 rounded-lg p-2.5 text-left lg:w-full lg:min-w-0"
                    style={{
                      background: isSelected ? "var(--primary-dim)" : "transparent",
                      color: isSelected ? "var(--primary-text)" : "var(--text-secondary)",
                    }}>
                    <Thumb url={category.image_url ?? null} alt="" size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{category.name}</span>
                      <span className="block pt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {category.series.reduce((sum, series) => sum + series.products.length, 0)} 件商品
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-w-0 space-y-6">
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
                    {selectedCategory.name}
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                    從 {selectedCategory.series.length} 個系列中挑選商品
                  </p>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1" aria-label="篩選商品系列">
                <button
                  onClick={() => setSelectedSeriesId(null)}
                  aria-pressed={!selectedSeriesId}
                  className="shrink-0 rounded-md px-3 py-2 text-sm font-medium"
                  style={{
                    background: !selectedSeriesId ? "var(--primary)" : "var(--bg-surface)",
                    border: !selectedSeriesId ? "1px solid var(--primary)" : "1px solid var(--border)",
                    color: !selectedSeriesId ? "var(--primary-fg)" : "var(--text-secondary)",
                  }}>
                  全部商品
                </button>
                {selectedCategory.series.map((series) => {
                  const isSelected = selectedSeriesId === series.id;
                  return (
                    <button
                      key={series.id}
                      onClick={() => setSelectedSeriesId(series.id)}
                      aria-pressed={isSelected}
                      className="shrink-0 rounded-md px-3 py-2 text-sm font-medium"
                      style={{
                        background: isSelected ? "var(--primary-dim)" : "var(--bg-surface)",
                        border: `1px solid ${isSelected ? "var(--primary)" : "var(--border)"}`,
                        color: isSelected ? "var(--primary-text)" : "var(--text-secondary)",
                      }}>
                      {series.name} <span style={{ color: "var(--text-muted)" }}>({series.products.length})</span>
                    </button>
                  );
                })}
              </div>
            </div>
              {closeStatus[selectedCategory.id]?.is_closed && (
              <div className="rounded-lg px-4 py-3 text-sm" style={{
                border: "1px solid var(--danger-border)",
                background: "var(--danger-dim)",
                color: "var(--danger)",
              }}>
                <strong>您的班級已結單</strong>
                {closeStatus[selectedCategory.id].closed_at && (
                  <span className="ml-1 text-xs">
                    （{new Date(closeStatus[selectedCategory.id].closed_at!).toLocaleString("zh-TW")}）
                  </span>
                )}
                ，如需更改請聯繫班級幹部。
              </div>
            )}
            <div className="space-y-8">
              {visibleSeries.map((series) => (
                <section key={series.id} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Thumb url={series.image_url ?? null} alt="" size={42} />
                    <div>
                      <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{series.name}</h3>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{series.products.length} 件商品</p>
                    </div>
                  </div>
                  {series.products.length === 0 ? (
                    <p className="py-4 text-sm" style={{ color: "var(--text-muted)" }}>這個系列暫時沒有商品</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {series.products.map((product) => (
                        <ProductCard key={product.id} product={product} onClick={() => setOpenProduct(product.id)} />
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
          onClose={() => setOpenProduct(null)}
          onAdded={() => {
            setOpenProduct(null);
            loadCart();
          }}
        />
      )}
    </div>
  );
}
