"use client";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Link from "next/link";
import { shopApi, ApiError } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type { CatalogCategoryOut, CatalogProductOut, ProductOut } from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { usePersistedState } from "@/hooks/usePersistedState";

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

  useEffect(() => {
    shopApi
      .getProduct(productId)
      .then(setProduct)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入商品失敗"));
  }, [productId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

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
      toast.error(e instanceof ApiError ? e.message : "加入失敗");
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid min-h-dvh place-items-center overflow-y-auto p-4"
      style={{ background: "var(--bg-overlay)" }}
      role="dialog"
      aria-modal="true"
      aria-label="選購商品">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto card p-6 space-y-4 animate-scale-in"
        style={{ boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-start gap-4">
          <Thumb url={displayImage} alt={product.name} size={88} />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>
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
          <button onClick={onClose} className="topbar-icon-btn" aria-label="關閉">
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
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
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
              className="btn btn-ghost w-9 h-9 p-0" aria-label="減少數量">−</button>
            <span className="text-base font-semibold w-8 text-center" style={{ color: "var(--text-primary)" }}>
              {qty}
            </span>
            <button
              onClick={() => setQty((q) =>
                product.is_unlimited ? q + 1 : Math.min(product.stock_quantity, q + 1))}
              className="btn btn-ghost w-9 h-9 p-0" aria-label="增加數量">＋</button>
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
      className="card card-hover overflow-hidden text-left"
      style={{ opacity: soldOut ? 0.6 : 1 }}>
      <div className="aspect-square w-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={uploadUrl(product.image_url)} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center" style={{ color: "var(--text-disabled)" }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 21" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>
          {product.name}
        </h3>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-base font-bold" style={{ color: "var(--primary)" }}>
            NT${product.price.toLocaleString()}
            {product.has_variants && (
              <span className="text-xs font-normal ml-1" style={{ color: "var(--text-muted)" }}>起</span>
            )}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {soldOut ? "已售完" : product.is_unlimited ? "供應中" : `剩 ${product.stock_quantity}`}
          </span>
        </div>
        {product.sale_end && (
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            截止 {new Date(product.sale_end).toLocaleString("zh-TW")}
          </p>
        )}
      </div>
    </button>
  );
}

// ── 購買頁 ────────────────────────────────────────────────────────────────────

export default function ShopPage() {
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = usePersistedState<string | null>("hcca:pref:shop:category:v1", null);
  const activityId = useSearchParams().get("activity_id") || undefined;

  const loadCatalog = useCallback(() => {
    setLoading(true);
    shopApi
      .catalog(undefined, activityId)
      .then((data) => {
        setCatalog(data);
        setSelectedCategoryId((current) => current ?? data[0]?.id ?? null);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [setSelectedCategoryId, activityId]);

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

  const scrollToSeries = (seriesId: string) => {
    document.getElementById(`shop-series-${seriesId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>校商訂購</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            依主題與系列選購，加入購物車後一次送單
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/shop/orders" className="btn btn-ghost">我的訂單</Link>
          <Link
            href="/shop/cart"
            className="btn"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            購物車{cartCount > 0 ? `（${cartCount}）` : ""}
          </Link>
        </div>
      </div>

      {loading ? (
        <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
      ) : catalog.length === 0 ? (
        <SmartEmptyState reason="none" subject="上架商品" message="店家還沒上架任何商品，請稍後再來看看" />
      ) : selectedCategory && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="card overflow-hidden">
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  主題
                </p>
              </div>
              <div className="flex gap-2 overflow-x-auto p-2 lg:block lg:space-y-1">
                {catalog.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategoryId(category.id)}
                    className="flex min-w-40 items-center gap-2 rounded-lg p-2 text-left lg:w-full lg:min-w-0"
                    style={category.id === selectedCategory.id
                      ? { background: "var(--primary-dim)", color: "var(--primary)" }
                      : { color: "var(--text-secondary)" }}>
                    <Thumb url={category.image_url} alt={category.name} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{category.name}</span>
                      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {category.series.reduce((sum, series) => sum + series.products.length, 0)} 件商品
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[160px_1fr]">
            <aside className="xl:sticky xl:top-20 xl:self-start">
              <div className="card p-2">
                <p className="px-2 py-2 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  系列
                </p>
                <div className="flex gap-2 overflow-x-auto xl:block xl:space-y-1">
                  {selectedCategory.series.map((series) => (
                    <button key={series.id} onClick={() => scrollToSeries(series.id)}
                      className="min-w-32 rounded-lg px-3 py-2 text-left text-xs xl:w-full xl:min-w-0"
                      style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                      <span className="block truncate font-medium">{series.name}</span>
                      <span style={{ color: "var(--text-muted)" }}>{series.products.length} 件</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <div className="space-y-8">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {selectedCategory.name}
                  </h2>
                  <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    {selectedCategory.series.length} 個系列
                  </p>
                </div>
              </div>
              {selectedCategory.series.map((series) => (
                <section key={series.id} id={`shop-series-${series.id}`} className="scroll-mt-24 space-y-3">
                  <div className="flex items-center gap-3">
                    <Thumb url={series.image_url} alt={series.name} size={42} />
                    <div>
                      <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{series.name}</h3>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{series.products.length} 件商品</p>
                    </div>
                  </div>
                  {series.products.length === 0 ? (
                    <p className="text-xs pl-1" style={{ color: "var(--text-muted)" }}>尚無商品</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 2xl:grid-cols-4">
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
