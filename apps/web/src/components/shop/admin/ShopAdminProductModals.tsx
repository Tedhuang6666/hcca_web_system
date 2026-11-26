"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ProductCategoryOut, ProductSeriesOut, ProductOut } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import ProductPurchaseRulesEditor, { emptyPurchaseRules, type PurchaseRulesDraft } from "@/components/shop/ProductPurchaseRulesEditor";
import { deadlineFromInput, deadlineInputValue } from "@/lib/shop-deadlines";
import { parseSmartOptionsText, uniqueSmartOptions } from "@/lib/shop-admin-options";
import { Field } from "@/components/shop/admin/ShopAdminFormFields";
import { ImageField, Thumb } from "@/components/shop/admin/ShopAdminMediaFields";

export function EntityModal({
  kind,
  initial,
  onClose,
  onSaved,
}: {
  kind: "category" | "series";
  initial: ProductCategoryOut | ProductSeriesOut | null; // null = 新增
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial !== null;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  const label = kind === "category" ? "商品分類" : "系列";

  return (
    <Modal title={`${editing ? "編輯" : "新增"}${label}`} onClose={onClose} size="md">
      <div className="space-y-3">
        <Field label="名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input min-h-11 w-full min-w-0"
            placeholder={kind === "category" ? "例如：校慶紀念商品" : "例如：紀念上衣"} />
        </Field>
        <Field label="描述（選填）">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input min-h-11 w-full min-w-0" />
        </Field>
        <Field label="圖片">
          <ImageField value={imageUrl} onChange={setImageUrl} />
        </Field>
        <div className="grid grid-cols-1 gap-3">
          <label className="flex min-h-11 items-center gap-2 text-xs text-fg-secondary!">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            顯示在商品目錄
          </label>
        </div>
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:gap-3">
          <button
            disabled={busy}
            onClick={async () => {
              if (!name.trim()) { toast.error("請輸入名稱"); return; }
              setBusy(true);
              try {
                const body = {
                  name: name.trim(),
                  description: description.trim() || null,
                  image_url: imageUrl,
                  is_active: isActive,
                };
                if (kind === "category") {
                  if (editing) await shopApi.updateCategory(initial!.id, body);
                  else {
                    await shopApi.createCategory(body);
                  }
                } else {
                  await shopApi.updateSeries(initial!.id, body);
                }
                toast.success("已儲存");
                onSaved();
              } catch (e) {
                toast.error(apiErrorMessage(e, "儲存失敗"));
              } finally {
                setBusy(false);
              }
            }}
            className="btn btn-primary min-h-11 w-full flex-1 sm:w-auto">
            {busy ? "儲存中…" : "儲存"}
          </button>
          <button onClick={onClose} className="btn btn-ghost min-h-11 w-full px-5 sm:w-auto">取消</button>
        </div>
      </div>
    </Modal>
  );
}

export function NewSeriesModal({
  categoryId, onClose, onSaved,
}: { categoryId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="新增系列" onClose={onClose} size="md">
      <div className="space-y-3">
        <Field label="名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input min-h-11 w-full min-w-0" placeholder="如：衣服系列" />
        </Field>
        <Field label="描述（選填）">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input min-h-11 w-full min-w-0" />
        </Field>
        <Field label="圖片">
          <ImageField value={imageUrl} onChange={setImageUrl} />
        </Field>
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:gap-3">
          <button disabled={busy} onClick={async () => {
            if (!name.trim()) { toast.error("請輸入名稱"); return; }
            setBusy(true);
            try {
              await shopApi.createSeries({
                category_id: categoryId,
                name: name.trim(),
                description: description.trim() || null,
                image_url: imageUrl,
              });
              toast.success("系列已建立");
              onSaved();
            } catch (e) {
              toast.error(apiErrorMessage(e, "建立失敗"));
            } finally { setBusy(false); }
          }} className="btn btn-primary min-h-11 w-full flex-1 sm:w-auto">
            {busy ? "建立中…" : "建立"}
          </button>
          <button onClick={onClose} className="btn btn-ghost min-h-11 w-full px-5 sm:w-auto">取消</button>
        </div>
      </div>
    </Modal>
  );
}

export function ProductFormModal({
  categoryId,
  categories,
  seriesId,
  initial,
  onClose,
  onSaved,
}: {
  categoryId: string;
  categories: ProductCategoryOut[];
  seriesId: string | null;
  initial: ProductOut | null;
  onClose: () => void;
  onSaved: (product: ProductOut, close?: boolean) => void;
}) {
  const editing = initial !== null;
  const [selectedCategoryId, setSelectedCategoryId] = useState(categoryId);
  const [extraOpen, setExtraOpen] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<ProductOut | null>(null);
  const [variantDrafts, setVariantDrafts] = useState<{ id: string; name: string; text: string; images: Record<string, string> }[]>([]);
  const variantRef = useRef<HTMLDivElement>(null);
  type ProductMediaDraft = { id: string; image_url: string | null; kind: "product" | "model"; label: string };
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [media, setMedia] = useState<ProductMediaDraft[]>(
    () => {
      const photos = (initial?.media ?? []).map(({ id, image_url, kind, label }) => ({ id, image_url, kind, label: label ?? "" }));
      if (initial?.image_url && !photos.some((photo) => photo.image_url === initial.image_url)) {
        photos.unshift({ id: crypto.randomUUID(), image_url: initial.image_url, kind: "product", label: "" });
      }
      return photos;
    },
  );
  const [price, setPrice] = useState(String(initial?.price ?? 0));
  const [originalPrice, setOriginalPrice] = useState(initial?.original_price == null ? "" : String(initial.original_price));
  const [unitCost, setUnitCost] = useState("");
  const [costState, setCostState] = useState<"loading" | "ready" | "error">(editing ? "loading" : "ready");
  const [costAttempt, setCostAttempt] = useState(0);
  useEffect(() => {
    if (!initial?.id) return;
    let active = true;
    shopApi.getProductCost(initial.id).then((data) => {
      if (active) { setUnitCost(data.unit_cost == null ? "" : String(data.unit_cost)); setCostState("ready"); }
    }).catch(() => { if (active) setCostState("error"); });
    return () => { active = false; };
  }, [initial?.id, costAttempt]);
  const [stock, setStock] = useState(String(initial?.stock_quantity ?? 0));
  const [unlimited, setUnlimited] = useState(initial?.is_unlimited ?? false);
  const [maxQuantityPerUser, setMaxQuantityPerUser] = useState(
    initial?.max_quantity_per_user == null ? "" : String(initial.max_quantity_per_user),
  );
  const [saleEnd, setSaleEnd] = useState(deadlineInputValue(initial?.sale_end ?? null));
  const [purchaseRules, setPurchaseRules] = useState<PurchaseRulesDraft>(emptyPurchaseRules);
  const [rulesState, setRulesState] = useState<"loading" | "ready" | "error">(editing ? "loading" : "ready");
  const [rulesAttempt, setRulesAttempt] = useState(0);
  useEffect(() => {
    if (!initial?.id) return;
    let active = true;
    shopApi.getProductPurchaseRules(initial.id).then((rules) => {
      if (active) { setPurchaseRules({ ...emptyPurchaseRules, ...rules }); setRulesState("ready"); }
    }).catch(() => { if (active) setRulesState("error"); });
    return () => { active = false; };
  }, [initial?.id, rulesAttempt]);
  const [busy, setBusy] = useState(false);
  const [mediaUploadsInProgress, setMediaUploadsInProgress] = useState(0);
  type ProductField = "name" | "price" | "originalPrice" | "unitCost" | "stock" | "limit" | "variants";
  const [formError, setFormError] = useState<{ field: ProductField | null; message: string } | null>(null);
  const fieldRefs = useRef<Partial<Record<ProductField, HTMLInputElement | null>>>({});
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const showFieldError = (field: ProductField, message: string) => {
    setFormError({ field, message });
    if (field === "limit") setExtraOpen(true);
    if (field === "variants") variantRef.current?.focus();
    else if (field === "limit") requestAnimationFrame(() => fieldRefs.current[field]?.focus());
    else fieldRefs.current[field]?.focus();
  };
  const fieldError = (field: ProductField) => formError?.field === field ? (
    <p id={`shop-product-${field}-error`} role="alert" className="mt-1 text-sm text-danger!">{formError.message}</p>
  ) : null;

  const uploadProductImages = async (files: File[]) => {
    const remaining = Math.max(0, 20 - media.length);
    const selected = files.slice(0, remaining);
    if (files.length > remaining) {
      toast.error(`商品照片最多 20 張，這次只會上傳前 ${remaining} 張`);
    }
    if (selected.length === 0) return;

    setMediaUploadsInProgress((count) => count + selected.length);
    const results = await Promise.allSettled(selected.map((file) => shopApi.uploadImage(file)));
    const uploaded = results.flatMap((result) =>
      result.status === "fulfilled"
        ? [{ id: crypto.randomUUID(), image_url: result.value.url, kind: "product" as const, label: "" }]
        : [],
    );
    setMedia((current) => [...current, ...uploaded].slice(0, 20));
    if (uploaded[0]) setImageUrl((current) => current ?? uploaded[0].image_url);
    const failedCount = results.length - uploaded.length;
    if (failedCount > 0) {
      toast.error(`${failedCount} 張照片上傳失敗，請重新選取後再試`);
    }
    setMediaUploadsInProgress((count) => Math.max(0, count - selected.length));
  };

  const publishProduct = async (draft: ProductOut, checkStatus = false) => {
    setBusy(true);
    setFormError(null);
    try {
      const current = checkStatus ? await shopApi.getProduct(draft.id) : draft;
      const published = current.status === "active"
        ? current
        : await shopApi.activateProduct(draft.id);
      onSaved(published);
      toast.success("商品已上架，已開放訂購");
    } catch (error) {
      onSaved(draft, false);
      setFormError({ field: null, message: apiErrorMessage(error, "草稿已儲存，但尚未確認上架成功。請重試上架，或保留草稿稍後處理。") });
    } finally { setBusy(false); }
  };

  const saveProduct = async (publish: boolean) => {
    if (rulesState !== "ready" || costState !== "ready") return;
    setFormError(null);
    if (!name.trim()) { showFieldError("name", "請填寫商品名稱。"); return; }
    const priceValue = Number(price);
    const stockValue = Number(stock);
    if (!price.trim() || !Number.isInteger(priceValue) || priceValue < 0) {
      showFieldError("price", "售價請填寫 0 或正整數，單位為新台幣元。");
      return;
    }
    const originalPriceValue = originalPrice.trim() ? Number(originalPrice) : null;
    const unitCostValue = unitCost.trim() ? Number(unitCost) : null;
    if (unitCostValue !== null && (!Number.isSafeInteger(unitCostValue) || unitCostValue < 0 || unitCostValue > 2147483647)) {
      showFieldError("unitCost", "成本請填寫 0 至 2,147,483,647 的整數，或留空表示未設定。");
      return;
    }
    if (originalPriceValue !== null && (!Number.isSafeInteger(originalPriceValue) || originalPriceValue < priceValue)) {
      showFieldError("originalPrice", "原價請填寫不低於售價的整數，或留空取消原價顯示。");
      return;
    }
    if (!unlimited && (!stock.trim() || !Number.isInteger(stockValue) || stockValue < 0)) {
      showFieldError("stock", "可訂購數量請填寫 0 或正整數；不限量時請勾選「不限制總訂購數量」。");
      return;
    }
    const maxQuantity = maxQuantityPerUser.trim() ? Number(maxQuantityPerUser) : null;
    if (maxQuantity !== null && (!Number.isInteger(maxQuantity) || maxQuantity < 1)) {
      showFieldError("limit", "每人限購數量請填寫正整數，或留空表示不限購。");
      return;
    }
    const variantGroups = variantDrafts.map((draft, sort_order) => ({
      name: draft.name.trim(),
      sort_order,
      options: uniqueSmartOptions(parseSmartOptionsText(draft.text)).map((option, index) => ({
        ...option, image_url: draft.images[option.value] || null, sort_order: index,
      })),
    }));
    if (!editing && variantGroups.some((group) => !group.name || group.name.length > 100
      || group.options.length === 0 || group.options.some((option) => option.value.length > 100
        || !Number.isSafeInteger(option.price_delta)))) {
      showFieldError("variants", "請填寫每組規格名稱與至少一個選項；名稱及選項最多 100 字，加價須為整數。");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
        media: media.flatMap(({ image_url, kind, label }, sort_order) =>
          image_url ? [{ image_url, kind, label: label.trim() || null, sort_order }] : []),
        price: priceValue,
        original_price: originalPriceValue,
        unit_cost: unitCostValue,
        stock_quantity: Number.isInteger(stockValue) && stockValue >= 0 ? stockValue : 0,
        is_unlimited: unlimited,
        max_quantity_per_user: maxQuantity,
        purchase_rules: purchaseRules,
        sale_end: deadlineFromInput(saleEnd),
      };
      const savedProduct = editing
        ? await shopApi.updateProduct(initial!.id, {
            ...body,
            category_id: selectedCategoryId,
            series_id: seriesId,
          })
        : await shopApi.createProduct({
            ...body,
            variant_groups: variantGroups,
            category_id: selectedCategoryId,
            series_id: seriesId,
          });
      if (publish) {
        setPendingProduct(savedProduct);
        await publishProduct(savedProduct);
      } else {
        onSaved(savedProduct);
        toast.success(editing ? "商品已更新" : "草稿已儲存，可稍後繼續編輯與上架");
      }
    } catch (e) {
      setFormError({ field: null, message: apiErrorMessage(e, "商品尚未儲存，請重試；你填寫的內容已保留。") });
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`${editing ? "編輯" : "新增"}商品`} onClose={() => { if (!busy && mediaUploadsInProgress === 0) onClose(); }} size="xl"
      footer={(
        <>
          {formError?.field === null && <p role="alert" className="w-full text-sm text-danger!">{formError.message}</p>}
          <div className="shop-product-actions">
            {pendingProduct ? (
              <>
                <button type="button" disabled={busy} onClick={onClose} className="btn btn-secondary min-h-11">保留草稿並關閉</button>
                <button type="button" disabled={busy} onClick={() => void publishProduct(pendingProduct, true)} className="btn btn-primary min-h-11">{busy ? "上架中…" : "重試上架"}</button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy || mediaUploadsInProgress > 0 || rulesState !== "ready" || costState !== "ready"} onClick={() => void saveProduct(false)} className={`btn min-h-11 ${editing ? "btn-primary" : "btn-secondary"}`}>
                  {busy ? "儲存中…" : editing ? "儲存商品" : "儲存草稿"}
                </button>
                {!editing && <button type="button" disabled={busy || mediaUploadsInProgress > 0 || rulesState !== "ready" || costState !== "ready"} onClick={() => void saveProduct(true)} className="btn btn-primary min-h-11">
                  {mediaUploadsInProgress > 0 ? "照片上傳中…" : busy ? "儲存與上架中…" : "建立並上架"}
                </button>}
              </>
            )}
          </div>
        </>
      )}>
      {pendingProduct ? (
        <div className="space-y-3" role="status">
          <h3 className="text-lg font-semibold">{pendingProduct.name}・草稿已儲存</h3>
          <p className="text-sm text-fg-secondary!">商品與規格已保留，重試上架不會重複建立商品。</p>
        </div>
      ) : <div className="shop-product-form space-y-5">
        {!editing && !seriesId && categories.length > 1 ? (
          <Field label="商品分類">
            <select className="input min-h-11 w-full min-w-0" value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>
        ) : <p className="text-sm text-fg-secondary!">商品分類：{categories.find((category) => category.id === selectedCategoryId)?.name}{seriesId ? "／目前系列" : ""}</p>}
        <div>
          <Field label="商品名稱">
            <input maxLength={200} placeholder="例如：校慶紀念衫" value={name} onChange={(e) => setName(e.target.value)} className="input min-h-11 w-full min-w-0"
              ref={(node) => { fieldRefs.current.name = node; }}
              aria-invalid={formError?.field === "name" || undefined}
              aria-describedby={formError?.field === "name" ? "shop-product-name-error" : undefined} />
          </Field>
          {fieldError("name")}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Field label="原價（新台幣元，選填）">
              <input type="number" min={0} step={1} value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} className="input min-h-11 w-full min-w-0" inputMode="numeric"
                ref={(node) => { fieldRefs.current.originalPrice = node; }}
                aria-invalid={formError?.field === "originalPrice" || undefined}
                aria-describedby={formError?.field === "originalPrice" ? "shop-product-originalPrice-error" : "shop-product-original-price-help"} />
            </Field>
            {fieldError("originalPrice")}
            <p id="shop-product-original-price-help" className="mt-1 text-xs text-fg-secondary!">低於原價時顯示劃線價；套組與其他優惠以售價繼續計算。</p>
          </div>
          <div>
            <Field label="售價（新台幣元）">
              <input type="number" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} className="input min-h-11 w-full min-w-0" inputMode="numeric"
                ref={(node) => { fieldRefs.current.price = node; }}
                aria-invalid={formError?.field === "price" || undefined}
                aria-describedby={formError?.field === "price" ? "shop-product-price-error" : undefined} />
            </Field>
            {fieldError("price")}
          </div>
          <div>
            <Field label="可訂購數量（件）">
              <input type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} disabled={unlimited}
                className="input min-h-11 w-full min-w-0" inputMode="numeric"
                ref={(node) => { fieldRefs.current.stock = node; }}
                aria-invalid={formError?.field === "stock" || undefined}
                aria-describedby={formError?.field === "stock" ? "shop-product-stock-error" : undefined} />
            </Field>
            {fieldError("stock")}
          </div>
        </div>
        <div>
          <Field label="內部單位成本（新台幣元，選填）">
            <input type="number" min={0} max={2147483647} step={1} inputMode="numeric" value={unitCost}
              disabled={costState !== "ready"} onChange={(event) => setUnitCost(event.target.value)} className="input min-h-11 w-full min-w-0"
              ref={(node) => { fieldRefs.current.unitCost = node; }}
              aria-invalid={formError?.field === "unitCost" || undefined}
              aria-describedby={`shop-product-cost-hint${formError?.field === "unitCost" ? " shop-product-unitCost-error" : ""}`} />
          </Field>
          {fieldError("unitCost")}
          <p id="shop-product-cost-hint" className="mt-1 text-xs text-fg-secondary!">
            購買者看不到；各規格共用此成本，修改後會重算歷史毛利。
          </p>
          {costState === "loading" && <p role="status">正在讀取商品成本…</p>}
          {costState === "error" && <p role="alert" className="text-sm text-danger!">
            成本讀取失敗，請重新讀取後再儲存。
            <button type="button" className="btn btn-secondary min-h-11" onClick={() => {
              setCostState("loading"); setCostAttempt((value) => value + 1);
            }}>重新讀取成本</button>
          </p>}
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm text-fg-secondary!">
          <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
          不限制總訂購數量
        </label>
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-fg-primary!">商品照片</h3>
            <p className="mt-1 text-xs text-fg-muted!">
              首張為主圖，最多 20 張。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={media.length >= 20 || mediaUploadsInProgress > 0}
              onClick={() => mediaInputRef.current?.click()}
              className="btn btn-ghost min-h-11 text-xs">
              {mediaUploadsInProgress > 0 ? `上傳中 ${mediaUploadsInProgress} 張…` : "選取照片"}
            </button>
            <input ref={mediaInputRef} type="file" accept="image/*" multiple className="sr-only"
              aria-label="一次選取多張商品照片" disabled={media.length >= 20 || mediaUploadsInProgress > 0}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void uploadProductImages(files);
              }} />
            <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted!">
              <Thumb url={imageUrl} size={40} />
              <span>{imageUrl ? "目前商品主圖" : "尚未選擇主圖"}</span>
              {imageUrl && (
                <button type="button" onClick={() => setImageUrl(null)} className="underline underline-offset-2">
                  取消主圖
                </button>
              )}
            </div>
          </div>
          {media.map((item, index) => (
            <div key={item.id} className="flex min-w-0 items-start gap-3 rounded-lg border border-border! bg-surface! p-2">
              <Thumb url={item.image_url} size={56} />
              <div className="min-w-0 flex-1 space-y-2">
                <Field label={`第 ${index + 1} 張照片標註（選填）`}>
                  <input value={item.label} maxLength={100} placeholder="例如：正面、背面、徽章"
                    onChange={(event) => setMedia((current) => current.map((entry) =>
                      entry.id === item.id ? { ...entry, label: event.target.value } : entry))}
                    className="input min-h-11 w-full min-w-0" />
                </Field>
                <Field label="照片用途">
                  <select value={item.kind}
                    onChange={(event) => setMedia((current) => current.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, kind: event.target.value as "product" | "model" }
                        : entry))}
                    className="input min-h-11 w-full min-w-0">
                    <option value="product">商品照片</option>
                    <option value="model">模特兒宣傳照</option>
                  </select>
                </Field>
                <button type="button" disabled={!item.image_url}
                  aria-pressed={imageUrl === item.image_url}
                  onClick={() => setImageUrl(item.image_url)}
                  className="btn btn-ghost min-h-11 text-xs">
                  {imageUrl === item.image_url ? "目前主圖" : "設為主圖"}
                </button>
              </div>
              <button type="button" aria-label={`移除第 ${index + 1} 張照片`}
                onClick={() => {
                  if (imageUrl === item.image_url) setImageUrl(null);
                  setMedia((current) => current.filter((entry) => entry.id !== item.id));
                  setVariantDrafts((current) => current.map((draft) => ({ ...draft,
                    images: Object.fromEntries(Object.entries(draft.images).filter(([, url]) => url !== item.image_url)),
                  })));
                }}
                className="btn btn-ghost min-h-11 px-3 text-xs">移除</button>
            </div>
          ))}
          {media.length === 0 && <p className="text-xs text-fg-muted!">尚未新增商品照片。</p>}
        </section>
        {!editing && (
          <div ref={variantRef} tabIndex={-1} aria-label="商品規格" aria-describedby={formError?.field === "variants" ? "shop-product-variants-error" : undefined} className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">尺寸、顏色等規格（選填）</h3>
              <p className="mt-1 text-xs text-fg-secondary!">有不同款式才需要新增；訂購時每組規格都須選一項。</p>
            </div>
            {variantDrafts.map((draft, index) => (
              <div key={draft.id} className="space-y-3 border-b border-border! pb-4">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label={`規格 ${index + 1} 名稱`}>
                      <input maxLength={100} className="input min-h-11 w-full min-w-0" value={draft.name} placeholder="例如：尺寸"
                        onChange={(event) => setVariantDrafts((current) => current.map((row) => row.id === draft.id ? { ...row, name: event.target.value } : row))} />
                    </Field>
                  </div>
                  <button type="button" className="btn btn-ghost min-h-11" aria-label={`移除規格 ${index + 1}`} onClick={() => setVariantDrafts((current) => current.filter((row) => row.id !== draft.id))}>移除</button>
                </div>
                <Field label={`規格 ${index + 1} 選項（逗號或換行分隔）`}>
                  <textarea rows={2} className="input min-h-11 w-full min-w-0 resize-y" value={draft.text} placeholder={draft.name === "顏色" ? "黑, 白, 藍" : "S, M, L, XL:50"}
                    onChange={(event) => setVariantDrafts((current) => current.map((row) => row.id === draft.id ? { ...row, text: event.target.value } : row))} />
                </Field>
                <p className="text-xs text-fg-secondary!">加價可寫 XL:50，表示 XL 加 50 元；未填加價就是原價。</p>
                {uniqueSmartOptions(parseSmartOptionsText(draft.text)).map((option) => (
                  <Field key={option.value} label={`${draft.name || `規格 ${index + 1}`}・${option.value} 圖片`}>
                    <select className="input min-h-11 w-full min-w-0" value={draft.images[option.value] ?? ""}
                      onChange={(event) => setVariantDrafts((current) => current.map((row) => row.id === draft.id
                        ? { ...row, images: { ...row.images, [option.value]: event.target.value } } : row))}>
                      <option value="">不指定圖片</option>
                      {media.map((photo, photoIndex) => photo.image_url && <option key={photo.id} value={photo.image_url}>
                        {photo.label.trim() || `商品照片 ${photoIndex + 1}`}
                      </option>)}
                    </select>
                  </Field>
                ))}
                {draft.text.trim() && <p className="text-xs text-fg-secondary!">從上方商品照片指定對應圖片，點選選項時會自動顯示。</p>}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {["尺寸", "顏色", "自訂規格"].map((label) => <button key={label} type="button" className="btn btn-secondary min-h-11 text-sm"
                onClick={() => setVariantDrafts((current) => [...current, { id: crypto.randomUUID(), name: label === "自訂規格" ? "" : label, text: "", images: {} }])}>加入{label}</button>)}
            </div>
            {fieldError("variants")}
          </div>
        )}
        {rulesState === "ready" ? <ProductPurchaseRulesEditor value={purchaseRules} onChange={setPurchaseRules}
          categoryId={selectedCategoryId} productId={initial?.id ?? null}
          disabled={busy} />
          : rulesState === "loading" ? <p role="status" className="text-sm">正在讀取購買資格…</p>
            : <p role="alert" className="text-sm text-danger!">
              購買資格讀取失敗，為保留原有名單，請重新讀取後再儲存。
              <button type="button" className="btn btn-secondary min-h-11" onClick={() => {
                setRulesState("loading"); setRulesAttempt((current) => current + 1);
              }}>重新讀取購買資格</button>
            </p>}
        <details open={extraOpen} onToggle={(event) => setExtraOpen(event.currentTarget.open)} className="border-t border-border!">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">更多設定（描述、限購、截止時間、劃位）</summary>
          <div className="space-y-4 pt-2">
            <Field label="商品描述（選填）">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                className="input w-full min-h-28 resize-y" rows={4}
                placeholder="可分行填寫規格、取貨方式或注意事項" />
            </Field>
            <div>
              <Field label="每人限購數量（留空表示不限購）">
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={maxQuantityPerUser}
                  ref={(node) => { fieldRefs.current.limit = node; }}
                  aria-invalid={formError?.field === "limit" || undefined}
                  aria-describedby={formError?.field === "limit" ? "shop-product-limit-error" : undefined}
                  onChange={(e) => setMaxQuantityPerUser(e.target.value)}
                  className="input min-h-11 w-full min-w-0"
                  placeholder="例如：1"
                />
              </Field>
              {fieldError("limit")}
              <p className="mt-1 text-xs text-fg-muted!">
                同一帳號累計計算；取消或退款的訂單不計入。
              </p>
            </div>
            <Field label="單品截止時間（台北時間，選填）">
              <input type="datetime-local" value={saleEnd} onChange={(e) => setSaleEnd(e.target.value)}
                className="input min-h-11 w-full min-w-0" />
              <p className="mt-1 text-xs text-fg-muted!">
                留空沿用班聯統一截止時間；單品可提前截止，設定較晚時間仍受統一期限限制。
              </p>
              {initial?.effective_sale_end && <p className="mt-1 text-xs text-fg-secondary!">
                目前有效截止：{new Date(initial.effective_sale_end).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
              </p>}
            </Field>
          </div>
        </details>
        {editing && <p className="text-xs text-fg-secondary!">尺寸、顏色等既有規格可在商品詳情設定。</p>}
      </div>}
    </Modal>
  );
}
