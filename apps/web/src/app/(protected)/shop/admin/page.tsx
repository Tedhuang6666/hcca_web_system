"use client";
import ShopOfficesPanel from "@/components/shop/ShopOfficesPanel";
import ShopSheetImportPanel from "@/components/shop/ShopSheetImportPanel";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { shopApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import Modal from "@/components/ui/Modal";
import CopyButton from "@/components/ui/CopyButton";
import ProductSizeChartEditor from "@/components/shop/ProductSizeChartEditor";
import ShopNoteGroupsPanel from "@/components/shop/ShopNoteGroupsPanel";
import type { ProductCategoryOut, ProductSeriesOut, ProductOut } from "@/lib/types";
import ShopPromotionPanel from "./ShopPromotionPanel";
import StatsView from "@/components/shop/admin/ShopStatsView";
import { listProductChoices } from "@/lib/shop-admin-data";
import { MiniBtn } from "@/components/shop/admin/ShopAdminFormFields";
import { confirmAction } from "@/components/ui/ConfirmDialog";
import { Thumb } from "@/components/shop/admin/ShopAdminMediaFields";
import { EntityModal, NewSeriesModal, ProductFormModal } from "@/components/shop/admin/ShopAdminProductModals";
import { VariantManager } from "@/components/shop/admin/ShopAdminVariantManager";
import ShopAdminSortableList from "@/components/shop/admin/ShopAdminSortableList";
import {
  createShopAdminCatalogActions,
  listAllProducts,
} from "@/components/shop/admin/ShopAdminCatalogActions";



























const STATUS_LABEL: Record<string, string> = {
  draft: "草稿", testing: "測試中", active: "上架中", sold_out: "售罄", cancelled: "已下架",
};

export default function ShopAdminPage() {
  const { can } = usePermissions();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const tab = requestedView === "stats" || requestedView === "promotions" || requestedView === "offices" || requestedView === "imports" || requestedView === "note-groups" ? requestedView : "catalog";
  const [clearOrdersOpen, setClearOrdersOpen] = useState(false);
  const [clearingOrders, setClearingOrders] = useState(false);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [productStatusBusy, setProductStatusBusy] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [productActionError, setProductActionError] = useState("");
  const allowed = can("shop:manage");

  // 一層一層的選取狀態
  const [cat, setCat] = useState<ProductCategoryOut | null>(null);
  const [series, setSeries] = useState<ProductSeriesOut | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // 各層資料
  const [categories, setCategories] = useState<ProductCategoryOut[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [seriesList, setSeriesList] = useState<ProductSeriesOut[]>([]);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [directProducts, setDirectProducts] = useState<ProductOut[]>([]);
  const [allProducts, setAllProducts] = useState<ProductOut[]>([]);
  const [product, setProduct] = useState<ProductOut | null>(null);

  const clearAllOrders = async () => {
    setClearingOrders(true);
    try {
      const result = await shopApi.clearAllOrders();
      setClearOrdersOpen(false);
      setStatsRefreshKey((current) => current + 1);
      if (result.deleted_order_count > 0) {
        toast.success(`已清除 ${result.deleted_order_count} 筆訂單，並回補庫存與優惠使用次數`);
      } else {
        toast.info("目前沒有商品訂單資料");
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "清除商品訂購資料失敗"));
    } finally {
      setClearingOrders(false);
    }
  };

  const orderLink = (id: string) => {
    const url = new URL("/shop", window.location.origin);
    url.searchParams.set("product", id);
    return url.toString();
  };

  // Modal
  const [catModal, setCatModal] = useState<{ initial: ProductCategoryOut | null } | null>(null);
  const [seriesModal, setSeriesModal] = useState<{ initial: ProductSeriesOut | null } | null>(null);
  const [productModal, setProductModal] = useState<{
    initial: ProductOut | null;
    seriesId?: string | null;
  } | null>(null);

  const loadCategories = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError("");
    shopApi
      .listCategories()
      .then(setCategories)
      .catch((error) => setCatalogError(apiErrorMessage(error, "無法載入活動，請重新載入。")))
      .finally(() => setCatalogLoading(false));
  }, []);
  const loadSeries = useCallback((categoryId: string) => {
    shopApi.listSeries({ category_id: categoryId }).then(setSeriesList).catch((error) => {
      setSeriesList([]);
      setCatalogError(apiErrorMessage(error, "無法載入商品系列，請重新載入。"));
    });
  }, []);
  const loadProducts = useCallback((sid: string) => {
    listAllProducts({ series_id: sid }).then(setProducts).catch((error) => {
      setProducts([]);
      toast.error(apiErrorMessage(error, "載入商品清單失敗"));
    });
  }, []);
  const loadDirectProducts = useCallback((categoryId: string) => {
    listAllProducts({ category_id: categoryId }).then(setDirectProducts).catch((error) => {
      setDirectProducts([]);
      toast.error(apiErrorMessage(error, "載入商品清單失敗"));
    });
  }, []);
  const loadAllProducts = useCallback(() => {
    listProductChoices().then(setAllProducts).catch(() => setAllProducts([]));
  }, []);
  const loadProduct = useCallback((pid: string) => {
    shopApi.getProduct(pid).then(setProduct).catch((error) => {
      setProduct(null);
      toast.error(apiErrorMessage(error, "載入商品詳情失敗"));
    });
  }, []);

  const { saveCategoryOrder, saveSeriesOrder, saveProductOrder } =
    createShopAdminCatalogActions({
      cat,
      categories,
      setCategories,
      seriesList,
      setSeriesList,
      directProducts,
      setDirectProducts,
      products,
      setProducts,
      setOrderSaving,
    });

  useEffect(() => {
    if (!allowed) return;
    loadCategories();
    loadAllProducts();
  }, [allowed, loadAllProducts, loadCategories]);

  useEffect(() => {
    if (cat) {
      loadSeries(cat.id);
      loadDirectProducts(cat.id);
    }
  }, [cat, loadDirectProducts, loadSeries]);
  useEffect(() => { if (series) loadProducts(series.id); }, [series, loadProducts]);
  useEffect(() => { if (productId) loadProduct(productId); }, [productId, loadProduct]);

  if (!allowed) {
    return (
      <div className="py-20 text-center text-fg-muted!" >
        <p className="text-sm">需要「管理商品」權限才能存取此頁。</p>
      </div>
    );
  }

  const delCategory = async (c: ProductCategoryOut) => {
    if (!(await confirmAction({ title: `確定刪除活動「${c.name}」？活動下必須沒有系列或商品才能刪除。`, danger: true }))) return;
    try {
      await shopApi.deleteCategory(c.id);
      loadCategories();
      if (cat?.id === c.id) selectCategory(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };
  const delSeries = async (s: ProductSeriesOut) => {
    if (!(await confirmAction({ title: `確定刪除系列「${s.name}」？系列下必須沒有商品才能刪除。`, danger: true }))) return;
    try {
      await shopApi.deleteSeries(s.id);
      if (cat) loadSeries(cat.id);
      if (series?.id === s.id) selectSeries(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };
  const delProduct = async (p: ProductOut) => {
    if (!(await confirmAction({ title: `確定刪除商品「${p.name}」？已有訂單紀錄的商品無法刪除。`, danger: true }))) return;
    try {
      await shopApi.deleteProduct(p.id);
      toast.success("商品已刪除");
      if (p.category_id && cat?.id === p.category_id) loadDirectProducts(p.category_id);
      if (p.series_id && series?.id === p.series_id) loadProducts(p.series_id);
      loadAllProducts();
      if (productId === p.id) {
        setProductId(null);
        setProduct(null);
        setMobileDetailOpen(false);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };
  const toggleProduct = async (p: ProductOut, startTesting = false) => {
    if (productStatusBusy) return;
    if (p.status === "testing" && !(await confirmAction({
      title: `正式開放「${p.name}」？`,
      description: "將清除這項商品的測試訂單、付款／收款等相關紀錄，並回補庫存。此操作無法復原。",
      confirmLabel: "正式開放",
      danger: true,
    }))) return;
    setProductStatusBusy(true);
    setProductActionError("");
    try {
      const updated = startTesting
        ? await shopApi.testProduct(p.id)
        : p.status === "draft" || p.status === "cancelled" || p.status === "testing"
          ? await shopApi.activateProduct(p.id)
          : await shopApi.deactivateProduct(p.id);
      const updateList = (items: ProductOut[]) => items.map((item) => item.id === updated.id ? updated : item);
      setProducts(updateList);
      setDirectProducts(updateList);
      setAllProducts(updateList);
      if (productId === p.id) setProduct(updated);
      toast.success(startTesting ? "商品已開始測試" : p.status === "testing" ? "已清除測試資料並正式開放" : "商品狀態已更新");
    } catch (e) {
      const message = apiErrorMessage(e, "商品狀態尚未更新，請重試");
      setProductActionError(message);
      toast.error(message);
    } finally {
      setProductStatusBusy(false);
    }
  };
  const selectCategory = (next: ProductCategoryOut | null) => {
    setCat(next);
    setSeries(null);
    setProductId(null);
    setProduct(null);
    setProducts([]);
    setDirectProducts([]);
    setSeriesList([]);
  };
  const selectSeries = (next: ProductSeriesOut | null) => {
    setSeries(next);
    setProductId(null);
    setProduct(null);
    setProducts([]);
  };
  const selectProduct = (nextProductId: string) => {
    setProductId(nextProductId);
  };
  const productRow = (item: ProductOut) => (
    <div key={item.id} className="shop-admin-product-row flex min-w-0 flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => selectProduct(item.id)}
        className="shop-admin-product-select flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-left"
        style={productId === item.id
          ? { background: "var(--primary-dim)", color: "var(--primary-text)" }
          : { background: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
        <Thumb url={item.image_url} size={34} />
        <span className="flex-1 min-w-0">
          <span className="block break-words text-sm font-medium">{item.name}</span>
          <span className="block text-xs truncate text-fg-muted!" >
            NT${item.price.toLocaleString()} · {STATUS_LABEL[item.status] ?? item.status} · {item.variant_groups.length} 組規格
          </span>
        </span>
      </button>
      <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs lg:hidden"
        onClick={() => { selectProduct(item.id); setMobileDetailOpen(true); }}>
        詳情
      </button>
      <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs"
        onClick={() => setProductModal({ initial: item })}>
        編輯
      </button>
      <MiniBtn tone="danger" onClick={() => void delProduct(item)}>刪除</MiniBtn>
    </div>
  );

  const detailContent = !cat ? (
    <div className="p-6 text-sm text-fg-muted!" >尚未選擇商品</div>
  ) : productId && !product ? (
    <div className="p-6 text-sm text-fg-muted!" >載入商品詳情中…</div>
  ) : product ? (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-4">
        <Thumb url={product.image_url} size={72} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted!" >商品詳情</p>
          <h2 className="text-xl font-semibold mt-1 break-words text-fg-primary!" >{product.name}</h2>
          {product.description && (
            <p className="text-sm mt-2 whitespace-pre-line text-fg-secondary!" >
              {product.description}
            </p>
          )}
          <p className="text-xs mt-2 text-fg-muted!" >
            NT${product.price.toLocaleString()} · {product.is_unlimited ? "無限量" : `庫存 ${product.stock_quantity}`} · {STATUS_LABEL[product.status] ?? product.status}
            {product.effective_sale_end && ` · 截止 ${new Date(product.effective_sale_end).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}${product.sale_end ? "（單品設定）" : "（沿用活動）"}`}
            {product.max_quantity_per_user != null && ` · 每人限購 ${product.max_quantity_per_user} 件`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <MiniBtn tone="primary" onClick={() => setProductModal({ initial: product })}>編輯商品</MiniBtn>
        <CopyButton
          disabled={product.status !== "active" && product.status !== "testing"}
          value={() => orderLink(product.id)}
          label="複製訂購連結"
          icon="none"
          announcement="已複製商品訂購連結"
          failureHint="無法複製訂購連結，請確認瀏覽器剪貼簿權限"
          className="min-h-11 px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-45 sm:px-2.5 text-fg-secondary! border! border-border!"

        />
        {can("shop:test") && (product.status === "draft" || product.status === "cancelled") && (
          <MiniBtn disabled={productStatusBusy} onClick={() => void toggleProduct(product, true)}>開始測試</MiniBtn>
        )}
        <MiniBtn disabled={productStatusBusy} onClick={() => void toggleProduct(product)}>
          {productStatusBusy ? "更新中…" : product.status === "testing" ? "正式開放並清除測試資料" : product.status === "active" || product.status === "sold_out" ? "下架" : "上架"}
        </MiniBtn>
      </div>
      {product.status === "testing" && (
        <p className="text-sm text-fg-secondary!" >
          僅超管或具「測試商品」權限者能查看與試訂。正式開放時會清除這項商品的測試訂單及相關紀錄，並回補庫存。
        </p>
      )}
      {productActionError && <p role="alert" className="text-sm" style={{ color: "var(--text-danger)" }}>{productActionError}</p>}
      <VariantManager
        product={product}
        allProducts={allProducts}
        onChanged={() => { loadProduct(product.id); loadAllProducts(); }}
      />
      <ProductSizeChartEditor key={product.id} product={product}
        onChanged={() => { loadProduct(product.id); loadAllProducts(); }} />
    </div>
  ) : !series ? (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted!" >活動詳情</p>
          <h2 className="text-xl font-semibold mt-1 break-words text-fg-primary!" >{cat.name}</h2>
          <p className="text-sm mt-2 text-fg-muted!" >{cat.description || "無描述"}</p>
        </div>
        <Thumb url={cat.image_url} size={72} />
      </div>
      <div className="flex flex-wrap gap-2">
        <MiniBtn tone="primary" onClick={() => setCatModal({ initial: cat })}>編輯活動</MiniBtn>
        <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null, seriesId: null })}>新增商品</MiniBtn>
      </div>
    </div>
  ) : (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted!" >系列詳情</p>
          <h2 className="text-xl font-semibold mt-1 text-fg-primary!" >{series.name}</h2>
          <p className="text-sm mt-2 text-fg-muted!" >{series.description || "無描述"}</p>
        </div>
        <Thumb url={series.image_url} size={72} />
      </div>
      <div className="flex flex-wrap gap-2">
        <MiniBtn tone="primary" onClick={() => setSeriesModal({ initial: series })}>編輯系列</MiniBtn>
        <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null, seriesId: series.id })}>新增商品</MiniBtn>
      </div>
    </div>
  );

  return (
    <div className="shop-admin-page w-full min-w-0 space-y-5 max-w-7xl mx-auto px-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-fg-primary!" >{tab === "stats" ? "訂購統計" : tab === "promotions" ? "優惠設定" : tab === "offices" ? "教師處室設定" : tab === "imports" ? "組織預購同步" : tab === "note-groups" ? "購買名單備註分組" : "商品設定"}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab !== "catalog" && <Link href="/shop/admin" className="btn btn-secondary min-h-11">返回商品設定</Link>}
          {tab === "catalog" && <button type="button" className="btn btn-primary min-h-11" disabled={catalogLoading || !!catalogError || categories.length === 0}
            onClick={() => setProductModal({ initial: null, seriesId: null })}>新增商品</button>}
          {tab === "catalog" && <Link href="/shop/admin?view=promotions" className="btn btn-secondary min-h-11">設定優惠</Link>}
          {tab === "catalog" && <Link href="/shop/admin?view=note-groups" className="btn btn-secondary min-h-11">依備註查看購買名單</Link>}
          {tab === "catalog" && <Link href="/shop/admin?view=offices" className="btn btn-secondary min-h-11">教師處室設定</Link>}
          {tab === "catalog" && <Link href="/shop/admin?view=imports" className="btn btn-secondary min-h-11">組織預購同步</Link>}
          {tab === "catalog" && <Link href="/shop/council-orders#activity-order-closure-title" className="btn btn-secondary min-h-11">活動鎖單</Link>}
          {tab === "catalog" && <Link href="/shop" className="btn btn-ghost min-h-11">查看商品頁</Link>}
          {tab === "stats" && <Link href="/shop/council-orders" className="btn btn-ghost min-h-11">返回班聯工作</Link>}
        </div>
      </div>

      {tab === "stats" ? (
        <StatsView key={statsRefreshKey} />
      ) : tab === "promotions" ? (
        <ShopPromotionPanel />
      ) : tab === "offices" ? (
        <ShopOfficesPanel />
      ) : tab === "imports" ? (
        <ShopSheetImportPanel categories={categories} />
      ) : tab === "note-groups" ? (
        <ShopNoteGroupsPanel />
      ) : (
        <div className="card overflow-hidden lg:min-h-[620px]">
          {catalogError && <div role="alert" className="p-4 text-sm text-danger!" >
            <p>{catalogError}</p>
            <button type="button" className="btn btn-ghost min-h-11" onClick={() => {
              loadCategories();
              if (cat) { loadSeries(cat.id); loadDirectProducts(cat.id); }
              if (series) loadProducts(series.id);
            }}>重新載入商品目錄</button>
          </div>}
          <div className="grid grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,1.2fr)] lg:min-h-[620px]">
            <aside className="min-w-0 overflow-hidden flex flex-col border-r! border-r-border!" >
              <div className="px-4 py-3 flex items-center justify-between border-b! border-b-border!" >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted!" >活動</p>
                  <p className="text-xs mt-0.5 text-fg-muted!" >{categories.length} 個活動</p>
                </div>
                <MiniBtn tone="primary" onClick={() => setCatModal({ initial: null })}>新增活動</MiniBtn>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                <ShopAdminSortableList
                  items={categories}
                  label="商品主題"
                  disabled={catalogLoading || Boolean(catalogError) || orderSaving}
                  onReorder={saveCategoryOrder}
                  renderItem={(c, handle) => (
                    <div className="flex items-center gap-1">
                      {handle}
                      <button type="button" onClick={() => selectCategory(c)} disabled={orderSaving}
                        className="min-h-11 flex-1 min-w-0 flex items-center gap-2 p-2 rounded-lg text-left"
                        style={cat?.id === c.id
                          ? { background: "var(--primary-dim)", color: "var(--primary-text)" }
                          : { color: "var(--text-secondary)", opacity: c.is_active ? 1 : 0.6 }}>
                        <Thumb url={c.image_url} size={34} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate">{c.name}</span>
                          <span className="block text-xs truncate text-fg-muted!" >
                            {c.description || "無描述"}
                          </span>
                        </span>
                      </button>
                      <MiniBtn tone="danger" onClick={() => void delCategory(c)}>刪除</MiniBtn>
                    </div>
                  )}
                />
                {catalogLoading && <p role="status" className="p-4 text-sm">正在載入活動…</p>}
                {!catalogLoading && !catalogError && categories.length === 0 && <p className="p-4 text-sm text-fg-secondary!" >尚未建立活動。按「新增活動」開始，例如「校慶商品」。</p>}
              </div>
            </aside>

            <section className="min-w-0 overflow-hidden flex flex-col border-r! border-r-border!" >
              <div className="px-4 py-3 border-b! border-b-border!" >
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted!" >系列與商品</p>
                    <p className="text-sm font-medium truncate mt-0.5 text-fg-primary!" >
                      {cat ? cat.name : "請先選擇活動"}
                    </p>
                  </div>
                  {cat && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs lg:hidden"
                        onClick={() => setMobileDetailOpen(true)}>活動設定</button>
                      <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null, seriesId: null })}>新增商品</MiniBtn>
                      <MiniBtn tone="primary" onClick={() => setSeriesModal({ initial: null })}>新增系列</MiniBtn>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {!cat ? (
                  <p className="p-6 text-sm text-center text-fg-muted!" >尚未選擇活動</p>
                ) : (
                  <div className="divide-y border-border!" >
                    <div className="p-3">
                      <ShopAdminSortableList
                        items={directProducts}
                        label="商品品項"
                        disabled={catalogLoading || Boolean(catalogError) || orderSaving}
                        onReorder={(ordered) => saveProductOrder("category", cat.id, ordered)}
                        renderItem={(item, handle) => (
                          <div className="flex items-start gap-2">
                            {handle}
                            <div className="min-w-0 flex-1">{productRow(item)}</div>
                          </div>
                        )}
                      />
                    </div>
                    <ShopAdminSortableList
                      items={seriesList}
                      label="商品系列"
                      disabled={catalogLoading || Boolean(catalogError) || orderSaving}
                      onReorder={saveSeriesOrder}
                      renderItem={(s, handle) => (
                        <div className="border-b border-border!">
                          <div className="flex items-center gap-3 px-4 py-3" style={{ background: series?.id === s.id ? "var(--bg-elevated)" : undefined }}>
                            {handle}
                            <button type="button" onClick={() => selectSeries(s)} disabled={orderSaving} className="flex-1 min-h-11 min-w-0 text-left">
                              <p className="text-sm font-semibold truncate" style={{ color: series?.id === s.id ? "var(--primary-text)" : "var(--text-primary)" }}>{s.name}</p>
                              <p className="text-xs truncate text-fg-muted!" >{s.description || "無描述"}</p>
                            </button>
                            <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs lg:hidden" disabled={orderSaving}
                              onClick={() => { selectSeries(s); setMobileDetailOpen(true); }}>管理</button>
                            <MiniBtn onClick={() => setSeriesModal({ initial: s })}>編輯</MiniBtn>
                            <MiniBtn tone="danger" onClick={() => void delSeries(s)}>刪除</MiniBtn>
                          </div>
                          {series?.id === s.id && (
                            <div className="px-3 pb-3 space-y-2">
                              <div className="flex justify-end">
                                <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null, seriesId: s.id })}>新增商品</MiniBtn>
                              </div>
                              <ShopAdminSortableList
                                items={products}
                                label="商品品項"
                                disabled={catalogLoading || Boolean(catalogError) || orderSaving}
                                onReorder={(ordered) => saveProductOrder("series", s.id, ordered)}
                                renderItem={(item, productHandle) => (
                                  <div className="flex items-start gap-2">
                                    {productHandle}
                                    <div className="min-w-0 flex-1">{productRow(item)}</div>
                                  </div>
                                )}
                              />
                              {products.length === 0 && <p className="py-4 text-xs text-center text-fg-muted!" >此系列尚無商品</p>}
                            </div>
                          )}
                        </div>
                      )}
                    />
                    {seriesList.length === 0 && (
                      <p className="p-6 text-sm text-center text-fg-muted!" >
                        尚無系列
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="hidden min-w-0 lg:block overflow-y-auto">
              {detailContent}
            </section>
          </div>
        </div>
      )}

      {tab === "stats" && (
        <details className="border-t pt-4 border-border!" >
          <summary className="min-h-11 cursor-pointer text-sm text-fg-secondary!" >訂單資料維護</summary>
          <p className="mb-3 text-sm text-fg-secondary!" >清除會永久刪除所有活動的訂單，包含已收款資料，且無法復原。</p>
          <button type="button" onClick={() => setClearOrdersOpen(true)} className="btn btn-ghost min-h-11 text-danger!" >
            <Trash2 size={15} /> 清除所有商品訂購資料
          </button>
        </details>
      )}

      {clearOrdersOpen && (
        <Modal title="清除所有商品訂購資料？" onClose={() => {
          if (!clearingOrders) setClearOrdersOpen(false);
        }} size="md">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg p-3 border! border-border! bg-elevated!"
              >
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger!"  />
              <div className="space-y-2 text-sm text-fg-secondary!" >
                <p>這會永久刪除所有使用者、所有活動與所有狀態的商品訂單，包含已收款的訂單。</p>
                <p>系統會同步清除訂單明細、商品應收款與尚未寄出的確認通知，並回補訂單占用的庫存及優惠使用次數。</p>
                <p>商品目錄、購物車和稽核紀錄會保留。此動作無法復原。</p>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setClearOrdersOpen(false)} disabled={clearingOrders}
                className="btn btn-ghost min-h-11 px-4 disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void clearAllOrders()} disabled={clearingOrders}
                className="btn btn-danger min-h-11 px-4 disabled:opacity-50">
                {clearingOrders ? "清除中…" : "確認清除所有訂單"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {mobileDetailOpen && cat && (
        <div className="lg:hidden">
          <Modal
            title={product ? "商品詳情" : series ? "系列詳情" : "活動詳情"}
            onClose={() => setMobileDetailOpen(false)}
            size="2xl"
          >
            {detailContent}
          </Modal>
        </div>
      )}

      {/* Modals */}
      {catModal && (
        <EntityModal kind="category" initial={catModal.initial}
          onClose={() => setCatModal(null)}
          onSaved={() => { setCatModal(null); loadCategories(); }} />
      )}
      {seriesModal && cat && (
        seriesModal.initial
          ? <EntityModal kind="series" initial={seriesModal.initial}
              onClose={() => setSeriesModal(null)}
              onSaved={() => { setSeriesModal(null); loadSeries(cat.id); }} />
          : <NewSeriesModal categoryId={cat.id}
              onClose={() => setSeriesModal(null)}
              onSaved={() => { setSeriesModal(null); loadSeries(cat.id); }} />
      )}
      {productModal && categories.length > 0 && (
        <ProductFormModal
          categoryId={productModal.initial?.category_id ?? cat?.id ?? categories[0].id}
          categories={categories}
          seriesId={productModal.initial?.series_id ?? productModal.seriesId ?? null}
          initial={productModal.initial}
          onClose={() => setProductModal(null)}
          onSaved={(savedProduct, close = true) => {
            if (close) setProductModal(null);
            if (savedProduct.category_id !== cat?.id) {
              setCat(categories.find((category) => category.id === savedProduct.category_id) ?? null);
              setSeries(null);
            }
            if (savedProduct.series_id) {
              setProducts((current) => current.some((item) => item.id === savedProduct.id)
                ? current.map((item) => item.id === savedProduct.id ? savedProduct : item)
                : [...current, savedProduct]);
            } else {
              setDirectProducts((current) => current.some((item) => item.id === savedProduct.id)
                ? current.map((item) => item.id === savedProduct.id ? savedProduct : item)
                : [...current, savedProduct]);
            }
            setAllProducts((current) => current.some((item) => item.id === savedProduct.id)
              ? current.map((item) => item.id === savedProduct.id ? savedProduct : item)
              : [savedProduct, ...current]);
            setProductId(savedProduct.id);
            setProduct(savedProduct);
          }} />
      )}
    </div>
  );
}
