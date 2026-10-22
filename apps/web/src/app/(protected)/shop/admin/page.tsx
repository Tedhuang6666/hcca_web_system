"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { shopApi, classApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import Modal from "@/components/ui/Modal";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import type {
  ActivityOut,
  SchoolClassListItem,
  ProductCategoryOut,
  ProductSeriesOut,
  ProductOut,
  ProductVariantGroupOut,
  ProductVariantOptionOut,
  OrderSummaryOut,
} from "@/lib/types";
import ShopPromotionPanel from "./ShopPromotionPanel";
import ActivityDeadlines from "@/components/shop/ActivityDeadlines";
import { deadlineFromInput, deadlineInputValue } from "@/lib/shop-deadlines";

const ACTIVITY_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  ended: "已結束",
  archived: "已封存",
};

async function listProductChoices() {
  const products: ProductOut[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await shopApi.listProducts({ limit: "100", offset: String(offset) });
    products.push(...page);
    if (page.length < 100) return products;
  }
}

// ── 共用小元件 ────────────────────────────────────────────────────────────────

function Thumb({ url, size = 44 }: { url: string | null; size?: number }) {
  if (!url) {
    return (
      <div className="rounded-lg flex-shrink-0"
        style={{ width: size, height: size, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        aria-hidden="true" />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={uploadUrl(url)} alt="" className="rounded-lg object-cover flex-shrink-0"
      style={{ width: size, height: size, border: "1px solid var(--border)" }} />
  );
}

function ImageField({ value, onChange }: { value: string | null; onChange: (u: string | null) => void }) {
  const upload = (file: File, reportProgress: (progress: number) => void) =>
    shopApi.uploadImage(file, reportProgress);
  return (
    <div className="flex items-start gap-3">
      <Thumb url={value} size={48} />
      <div className="min-w-0 flex-1">
        <AnimatedFileUpload
          accept="image/*"
          label={value ? "拖曳新圖片到這裡" : "拖曳商品圖片到這裡"}
          hint="支援點擊選取或貼上圖片"
          onUpload={upload}
          onUploaded={(result) => onChange(result.url)}
        />
      </div>
      {value && (
        <button onClick={() => onChange(null)} className="text-xs" style={{ color: "var(--text-muted)" }}>
          移除
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </label>
  );
}

function MiniBtn({
  children, onClick, tone = "neutral", disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "primary" | "danger";
  disabled?: boolean;
}) {
  const style = {
    neutral: { color: "var(--text-secondary)", border: "1px solid var(--border)" },
    primary: { color: "var(--primary-text)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" },
    danger: { color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" },
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="min-h-11 px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-45 sm:px-2.5"
      style={style}>
      {children}
    </button>
  );
}

// ── 主題 / 系列 編輯 Modal ────────────────────────────────────────────────────

function EntityModal({
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
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [activityId, setActivityId] = useState(
    initial && "activity_id" in initial ? initial.activity_id ?? "" : "",
  );
  const [activities, setActivities] = useState<ActivityOut[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(kind === "category");
  const [activitiesLoadError, setActivitiesLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const label = kind === "category" ? "主題" : "系列";

  useEffect(() => {
    if (kind !== "category") return;
    let cancelled = false;
    void shopApi.listActivities()
      .then((rows) => {
        if (!cancelled) setActivities(rows);
      })
      .catch(() => {
        if (!cancelled) setActivitiesLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setActivitiesLoading(false);
      });
    return () => { cancelled = true; };
  }, [kind]);

  return (
    <Modal title={`${editing ? "編輯" : "新增"}${label}`} onClose={onClose} size="md">
      <div className="space-y-3">
        <Field label="名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full"
            placeholder={kind === "category" ? "例如：校慶紀念商品" : "例如：紀念上衣"} />
        </Field>
        <Field label="描述（選填）">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input w-full" />
        </Field>
        {kind === "category" && (
          <Field label="所屬活動">
            <select
              value={activityId}
              onChange={(e) => setActivityId(e.target.value)}
              className="input w-full"
              disabled={activitiesLoading || activitiesLoadError}
            >
              <option value="">一般商品（不分活動）</option>
              {activityId && !activities.some((activity) => activity.id === activityId) && (
                <option value={activityId}>目前所屬活動</option>
              )}
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}（{ACTIVITY_STATUS_LABEL[activity.status] ?? activity.status}）
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              選擇活動後，後續預購會列入該活動訂單；未指定時會列入一般商品訂單。已建立的訂單不會自動拆分。
            </p>
            {activitiesLoadError && (
              <p role="alert" className="mt-1 text-xs" style={{ color: "var(--danger)" }}>
                無法載入活動清單，請重新開啟此視窗再試一次。
              </p>
            )}
          </Field>
        )}
        <Field label="圖片">
          <ImageField value={imageUrl} onChange={setImageUrl} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="顯示順序（數字小的在前）">
            <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input w-full" inputMode="numeric" />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            顯示在商品目錄
          </label>
        </div>
        <div className="flex gap-3 pt-1">
          <button
            disabled={busy || (kind === "category" && activitiesLoading)}
            onClick={async () => {
              if (!name.trim()) { toast.error("請輸入名稱"); return; }
              setBusy(true);
              try {
                const body = {
                  name: name.trim(),
                  description: description.trim() || null,
                  image_url: imageUrl,
                  sort_order: Number(sortOrder) || 0,
                  is_active: isActive,
                };
                if (kind === "category") {
                  const categoryBody = { ...body, activity_id: activityId || null };
                  if (editing) await shopApi.updateCategory(initial!.id, categoryBody);
                  else {
                    await shopApi.createCategory(categoryBody);
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
            className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            {busy ? "儲存中…" : "儲存"}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </Modal>
  );
}

// 新增系列（需 category_id）
function NewSeriesModal({
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
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="如：衣服系列" />
        </Field>
        <Field label="描述（選填）">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input w-full" />
        </Field>
        <Field label="圖片">
          <ImageField value={imageUrl} onChange={setImageUrl} />
        </Field>
        <div className="flex gap-3 pt-1">
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
          }} className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            {busy ? "建立中…" : "建立"}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </Modal>
  );
}

// ── 商品 編輯 Modal ───────────────────────────────────────────────────────────

function ProductFormModal({
  categoryId,
  seriesId,
  initial,
  onClose,
  onSaved,
}: {
  categoryId: string;
  seriesId: string | null;
  initial: ProductOut | null;
  onClose: () => void;
  onSaved: (product: ProductOut) => void;
}) {
  const editing = initial !== null;
  type ProductMediaDraft = { id: string; image_url: string | null; kind: "product" | "model" };
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [media, setMedia] = useState<ProductMediaDraft[]>(
    () => (initial?.media ?? []).map(({ id, image_url, kind }) => ({ id, image_url, kind })),
  );
  const [price, setPrice] = useState(String(initial?.price ?? 0));
  const [stock, setStock] = useState(String(initial?.stock_quantity ?? 0));
  const [unlimited, setUnlimited] = useState(initial?.is_unlimited ?? false);
  const [maxQuantityPerUser, setMaxQuantityPerUser] = useState(
    initial?.max_quantity_per_user == null ? "" : String(initial.max_quantity_per_user),
  );
  const [saleEnd, setSaleEnd] = useState(deadlineInputValue(initial?.sale_end ?? null));
  const [requiresSeating, setRequiresSeating] = useState(initial?.requires_seating ?? false);
  const [seatingMode, setSeatingMode] = useState<string>(initial?.seating_mode ?? "at_purchase");
  const [busy, setBusy] = useState(false);
  const [mediaUploadsInProgress, setMediaUploadsInProgress] = useState(0);
  type ProductField = "name" | "price" | "stock" | "limit";
  const [formError, setFormError] = useState<{ field: ProductField | null; message: string } | null>(null);
  const fieldRefs = useRef<Record<ProductField, HTMLInputElement | null>>({ name: null, price: null, stock: null, limit: null });
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const showFieldError = (field: ProductField, message: string) => {
    setFormError({ field, message });
    fieldRefs.current[field]?.focus();
  };
  const fieldError = (field: ProductField) => formError?.field === field ? (
    <p id={`shop-product-${field}-error`} role="alert" className="mt-1 text-sm" style={{ color: "var(--danger)" }}>{formError.message}</p>
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
        ? [{ id: crypto.randomUUID(), image_url: result.value.url, kind: "product" as const }]
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

  return (
    <Modal title={`${editing ? "編輯" : "新增"}商品`} onClose={onClose} size="md">
      <div className="space-y-3">
        <div>
          <Field label="商品名稱">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full"
              ref={(node) => { fieldRefs.current.name = node; }}
              aria-invalid={formError?.field === "name" || undefined}
              aria-describedby={formError?.field === "name" ? "shop-product-name-error" : undefined} />
          </Field>
          {fieldError("name")}
        </div>
        <Field label="商品描述（選填）">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            className="input w-full min-h-28 resize-y" rows={4}
            placeholder="可分行填寫規格、取貨方式或注意事項" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Field label="售價（新台幣元）">
              <input type="number" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} className="input w-full" inputMode="numeric"
                ref={(node) => { fieldRefs.current.price = node; }}
                aria-invalid={formError?.field === "price" || undefined}
                aria-describedby={formError?.field === "price" ? "shop-product-price-error" : undefined} />
            </Field>
            {fieldError("price")}
          </div>
          <div>
            <Field label="可訂購數量（件）">
              <input type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} disabled={unlimited}
                className="input w-full" inputMode="numeric"
                ref={(node) => { fieldRefs.current.stock = node; }}
                aria-invalid={formError?.field === "stock" || undefined}
                aria-describedby={formError?.field === "stock" ? "shop-product-stock-error" : undefined} />
            </Field>
            {fieldError("stock")}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
          不限制總訂購數量
        </label>
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
              className="input w-full"
              placeholder="例如：1"
            />
          </Field>
          {fieldError("limit")}
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            同一帳號累計計算；取消或退款的訂單不計入。
          </p>
        </div>
        <Field label="單品截止時間（台北時間，選填）">
          <input type="datetime-local" value={saleEnd} onChange={(e) => setSaleEnd(e.target.value)}
            className="input w-full" />
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            留空沿用活動結單時間；需要延長此品項時，設定較晚的時間。清空並儲存可恢復沿用活動設定。
          </p>
          {initial?.effective_sale_end && <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            目前有效截止：{new Date(initial.effective_sale_end).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
          </p>}
        </Field>
        <section className="space-y-2 rounded-lg p-3"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>商品照片</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              可一次選取多張；尚未設定主圖時，首張會自動設為主圖。最多 20 張。
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
            <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
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
            <div key={item.id} className="flex min-w-0 items-start gap-3 rounded-lg p-2"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <Thumb url={item.image_url} size={56} />
              <div className="min-w-0 flex-1 space-y-2">
                <Field label="照片用途">
                  <select value={item.kind}
                    onChange={(event) => setMedia((current) => current.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, kind: event.target.value as "product" | "model" }
                        : entry))}
                    className="input w-full">
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
                }}
                className="btn btn-ghost min-h-11 px-3 text-xs">移除</button>
            </div>
          ))}
          {media.length === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>尚未新增商品照片。</p>}
        </section>
        <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={requiresSeating} onChange={(e) => setRequiresSeating(e.target.checked)} />
            此為需劃位票種（電影 / 演唱會等）
          </label>
          {requiresSeating && (
            <>
              <Field label="劃位時機">
                <select value={seatingMode} onChange={(e) => setSeatingMode(e.target.value)} className="input w-full">
                  <option value="at_purchase">購買即劃位</option>
                  <option value="scheduled">指定時間開放後自助劃位</option>
                  <option value="admin_assign">管理員依到場順序代為劃位</option>
                </select>
              </Field>
              {editing && (
                <Link href={`/seating/admin/${initial!.id}`} className="btn btn-ghost text-xs">
                  → 管理場次與座位圖
                </Link>
              )}
              {!editing && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>儲存後即可在商品上「管理場次與座位圖」。</p>
              )}
            </>
          )}
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {editing ? "尺寸、顏色等規格可在商品詳情設定。" : "先建立草稿，再設定尺寸、顏色等規格；按「上架」後才會開放訂購。"}
        </p>
        {formError?.field === null && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{formError.message}</p>}
        <div className="flex gap-3 pt-1">
          <button disabled={busy || mediaUploadsInProgress > 0} onClick={async () => {
            setFormError(null);
            if (!name.trim()) { showFieldError("name", "請填寫商品名稱。"); return; }
            const priceValue = Number(price);
            const stockValue = Number(stock);
            if (!price.trim() || !Number.isInteger(priceValue) || priceValue < 0) {
              showFieldError("price", "售價請填寫 0 或正整數，單位為新台幣元。");
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
            setBusy(true);
            try {
              const body = {
                name: name.trim(),
                description: description.trim() || null,
                image_url: imageUrl,
                media: media.flatMap(({ image_url, kind }, sort_order) =>
                  image_url && image_url !== imageUrl ? [{ image_url, kind, sort_order }] : []),
                price: priceValue,
                stock_quantity: Number.isInteger(stockValue) && stockValue >= 0 ? stockValue : 0,
                is_unlimited: unlimited,
                max_quantity_per_user: maxQuantity,
                sale_end: deadlineFromInput(saleEnd),
                requires_seating: requiresSeating,
                seating_mode: requiresSeating ? seatingMode : null,
              };
              const savedProduct = editing
                ? await shopApi.updateProduct(initial!.id, {
                    ...body,
                    category_id: categoryId,
                    series_id: seriesId,
                  })
                : await shopApi.createProduct({
                    ...body,
                    category_id: categoryId,
                    series_id: seriesId,
                  });
              onSaved(savedProduct);
              toast.success(editing ? "商品已更新" : "商品已建立");
            } catch (e) {
              setFormError({ field: null, message: apiErrorMessage(e, "商品尚未儲存，請重試；你填寫的內容已保留。") });
            } finally { setBusy(false); }
          }} className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            {mediaUploadsInProgress > 0 ? "照片上傳中…" : busy ? "儲存中…" : editing ? "儲存商品" : "建立草稿商品"}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </Modal>
  );
}

// ── 變體選項 編輯 Modal ───────────────────────────────────────────────────────

function OptionModal({
  groupId,
  initial,
  onClose,
  onSaved,
}: {
  groupId: string;
  initial: ProductVariantOptionOut | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial !== null;
  const [value, setValue] = useState(initial?.value ?? "");
  const [priceDelta, setPriceDelta] = useState(String(initial?.price_delta ?? 0));
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`${editing ? "編輯" : "新增"}選項`} onClose={onClose} size="sm">
      <div className="space-y-3">
        <Field label="選項值">
          <input value={value} onChange={(e) => setValue(e.target.value)} className="input w-full"
            placeholder="如：黑、中、XL" />
        </Field>
        <Field label="加價（可為 0 或負數）">
          <input value={priceDelta} onChange={(e) => setPriceDelta(e.target.value)} className="input w-full" inputMode="numeric" />
        </Field>
        <Field label="選項圖片（選填）">
          <ImageField value={imageUrl} onChange={setImageUrl} />
        </Field>
        <div className="flex gap-3 pt-1">
          <button disabled={busy} onClick={async () => {
            if (!value.trim()) { toast.error("請輸入選項值"); return; }
            setBusy(true);
            try {
              const body = {
                value: value.trim(),
                price_delta: Number(priceDelta) || 0,
                image_url: imageUrl,
              };
              if (editing) await shopApi.updateVariantOption(initial!.id, body);
              else await shopApi.addVariantOption(groupId, body);
              toast.success("已儲存");
              onSaved();
            } catch (e) {
              toast.error(apiErrorMessage(e, "儲存失敗"));
            } finally { setBusy(false); }
          }} className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            {busy ? "儲存中…" : "儲存"}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </Modal>
  );
}

type SmartOptionDraft = {
  value: string;
  price_delta: number;
  image_url: string | null;
};

type SmartSourceGroup = ProductVariantGroupOut & {
  source_label: string;
};

function parseSmartOptionsText(text: string): SmartOptionDraft[] {
  return text
    .split(/\r?\n|,/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(.+?)(?:\s*[:：]\s*|\s+)([+-]?\d+)$/);
      if (!match) return { value: raw, price_delta: 0, image_url: null };
      return {
        value: match[1].trim(),
        price_delta: Number(match[2]) || 0,
        image_url: null,
      };
    })
    .filter((option) => option.value);
}

function uniqueSmartOptions(options: SmartOptionDraft[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function VariantGroupModal({
  productId,
  initial,
  sourceGroups,
  onClose,
  onSaved,
}: {
  productId: string;
  initial: ProductVariantGroupOut | null;
  sourceGroups: SmartSourceGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial !== null;
  const [name, setName] = useState(initial?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));
  const [optionsText, setOptionsText] = useState("");
  const [sourceGroupId, setSourceGroupId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("請輸入規格類別名稱");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await shopApi.updateVariantGroup(initial.id, {
          name: name.trim(),
          sort_order: Number(sortOrder) || 0,
        });
      } else {
        const source = sourceGroups.find((group) => group.id === sourceGroupId);
        const copied = source?.options.map((option) => ({
          value: option.value,
          price_delta: option.price_delta,
          image_url: option.image_url,
        })) ?? [];
        const pasted = parseSmartOptionsText(optionsText);
        const options = uniqueSmartOptions([...copied, ...pasted]).map((option, index) => ({
          ...option,
          sort_order: index,
        }));
        await shopApi.addVariantGroup(productId, {
          name: name.trim(),
          sort_order: Number(sortOrder) || 0,
          options,
        });
      }
      toast.success("規格類別已儲存");
      onSaved();
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${editing ? "編輯" : "新增"}規格類別`} onClose={onClose} size="md">
      <div className="space-y-3">
        <Field label="群組名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="如：顏色、尺寸" />
        </Field>
        <Field label="排序">
          <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input w-full" inputMode="numeric" />
        </Field>
        {!editing && (
          <>
            {sourceGroups.length > 0 && (
              <Field label="複製既有群組選項（選填）">
                <select value={sourceGroupId} onChange={(e) => setSourceGroupId(e.target.value)} className="input w-full">
                  <option value="">不複製</option>
                  {sourceGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.source_label} / {group.name}（{group.options.length} 個）
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="追加選項（可用逗號或換行分隔；加價可寫 XL:50）">
              <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)}
                className="input w-full min-h-24" placeholder={"黑, 白, 藍\nS, M, L, XL:50"} />
            </Field>
          </>
        )}
        <div className="flex gap-3 pt-1">
          <button disabled={busy} onClick={submit} className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            {busy ? "儲存中…" : "儲存"}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </Modal>
  );
}

function SmartOptionsModal({
  target,
  sourceGroups,
  onClose,
  onSaved,
}: {
  target: ProductVariantGroupOut;
  sourceGroups: SmartSourceGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const sources = sourceGroups.filter((group) => group.id !== target.id && group.options.length > 0);
  const [sourceGroupId, setSourceGroupId] = useState(sources[0]?.id ?? "");
  const [optionsText, setOptionsText] = useState("");
  const [includePrice, setIncludePrice] = useState(true);
  const [includeImage, setIncludeImage] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);
  const [busy, setBusy] = useState(false);

  const source = sources.find((group) => group.id === sourceGroupId);
  const copiedOptions: SmartOptionDraft[] = source?.options.map((option) => ({
    value: option.value,
    price_delta: includePrice ? option.price_delta : 0,
    image_url: includeImage ? option.image_url : null,
  })) ?? [];
  const drafts = uniqueSmartOptions([...copiedOptions, ...parseSmartOptionsText(optionsText)]);
  const existing = new Set(target.options.map((option) => option.value.trim().toLowerCase()));
  const finalDrafts = skipExisting
    ? drafts.filter((option) => !existing.has(option.value.trim().toLowerCase()))
    : drafts;

  const submit = async () => {
    if (finalDrafts.length === 0) {
      toast.error("沒有可新增的選項");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(finalDrafts.map((option, index) =>
        shopApi.addVariantOption(target.id, {
          value: option.value,
          price_delta: option.price_delta,
          image_url: option.image_url,
          sort_order: target.options.length + index,
        })
      ));
      toast.success(`已新增 ${finalDrafts.length} 個選項`);
      onSaved();
    } catch (e) {
      toast.error(apiErrorMessage(e, "智慧新增失敗"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`智慧新增選項：${target.name}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="從其他群組複製">
            <select value={sourceGroupId} onChange={(e) => setSourceGroupId(e.target.value)} className="input w-full">
              <option value="">不複製</option>
              {sources.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.source_label} / {group.name}（{group.options.length} 個）
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={includePrice} onChange={(e) => setIncludePrice(e.target.checked)} />
              複製加價
            </label>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={includeImage} onChange={(e) => setIncludeImage(e.target.checked)} />
              複製圖片
            </label>
          </div>
        </div>
        <Field label="貼上更多選項（逗號或換行；加價可寫 XL:50）">
          <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)}
            className="input w-full min-h-28" placeholder={"XS, S, M, L, XL:50\n2XL:80"} />
        </Field>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
          自動略過目標群組中已存在的同名選項
        </label>
        <div className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            預計新增 {finalDrafts.length} 個選項
          </p>
          <div className="flex flex-wrap gap-2">
            {finalDrafts.slice(0, 24).map((option) => (
              <span key={`${option.value}-${option.price_delta}`} className="text-xs px-2 py-1 rounded-lg"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                {option.value}{option.price_delta ? ` ${option.price_delta > 0 ? "+" : ""}${option.price_delta}` : ""}
              </span>
            ))}
            {finalDrafts.length > 24 && (
              <span className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
                另 {finalDrafts.length - 24} 個
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button disabled={busy} onClick={submit} className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            {busy ? "新增中…" : "新增選項"}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </Modal>
  );
}

// ── 變體管理（一個商品下的多個規格類別） ────────────────────────────────────

function VariantManager({
  product,
  allProducts,
  onChanged,
}: {
  product: ProductOut;
  allProducts: ProductOut[];
  onChanged: () => void;
}) {
  const [optionModal, setOptionModal] = useState<
    { groupId: string; option: ProductVariantOptionOut | null } | null
  >(null);
  const [groupModal, setGroupModal] = useState<ProductVariantGroupOut | null | "new">(null);
  const [smartTarget, setSmartTarget] = useState<ProductVariantGroupOut | null>(null);
  const sourceProducts = [
    product,
    ...allProducts.filter((sourceProduct) => sourceProduct.id !== product.id),
  ];
  const sourceGroups: SmartSourceGroup[] = sourceProducts.flatMap((sourceProduct) =>
    sourceProduct.variant_groups.map((group) => ({
      ...group,
      source_label: sourceProduct.id === product.id ? product.name : sourceProduct.name,
    }))
  );

  const removeGroup = async (g: ProductVariantGroupOut) => {
    if (!confirm(`確定刪除規格類別「${g.name}」？`)) return;
    try {
      await shopApi.deleteVariantGroup(g.id);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };

  const removeOption = async (o: ProductVariantOptionOut) => {
    try {
      await shopApi.deleteVariantOption(o.id);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          規格類別（{product.variant_groups.length}）
        </p>
        <MiniBtn tone="primary" onClick={() => setGroupModal("new")}>+ 新增規格類別</MiniBtn>
      </div>
      {product.variant_groups.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          尚未設定規格。例如新增「尺寸」，再加入 S、M、L；訂購時每種規格都需選一項。
        </p>
      ) : (
        product.variant_groups.map((g) => (
          <div key={g.id} className="rounded-lg p-3 space-y-2"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{g.name}</p>
              <div className="flex flex-wrap gap-1.5">
                <MiniBtn tone="primary" onClick={() => setSmartTarget(g)}>批次新增選項</MiniBtn>
                <MiniBtn onClick={() => setGroupModal(g)}>編輯</MiniBtn>
                <MiniBtn tone="danger" onClick={() => removeGroup(g)}>刪除</MiniBtn>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => (
                <span key={o.id}
                  className="inline-flex items-center gap-1.5 rounded-lg pl-2 pr-1 py-1 text-xs"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                  {o.image_url && <Thumb url={o.image_url} size={20} />}
                  <span style={{ color: "var(--text-primary)" }}>{o.value}</span>
                  {o.price_delta !== 0 && (
                    <span style={{ color: "var(--primary)" }}>
                      {o.price_delta > 0 ? `+${o.price_delta}` : o.price_delta}
                    </span>
                  )}
                  <button onClick={() => setOptionModal({ groupId: g.id, option: o })}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center" style={{ color: "var(--text-muted)" }} aria-label={`編輯${o.value}`}><Pencil size={14} aria-hidden /></button>
                  <button onClick={() => removeOption(o)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center" style={{ color: "var(--text-muted)" }} aria-label={`刪除${o.value}`}><Trash2 size={14} aria-hidden /></button>
                </span>
              ))}
              <button onClick={() => setOptionModal({ groupId: g.id, option: null })}
                className="text-xs px-2 py-1 rounded-lg"
                style={{ color: "var(--primary)", border: "1px dashed var(--border-strong)" }}>
                + 選項
              </button>
            </div>
          </div>
        ))
      )}
      {optionModal && (
        <OptionModal
          groupId={optionModal.groupId}
          initial={optionModal.option}
          onClose={() => setOptionModal(null)}
          onSaved={() => { setOptionModal(null); onChanged(); }}
        />
      )}
      {groupModal && (
        <VariantGroupModal
          productId={product.id}
          initial={groupModal === "new" ? null : groupModal}
          sourceGroups={sourceGroups}
          onClose={() => setGroupModal(null)}
          onSaved={() => { setGroupModal(null); onChanged(); }}
        />
      )}
      {smartTarget && (
        <SmartOptionsModal
          target={smartTarget}
          sourceGroups={sourceGroups}
          onClose={() => setSmartTarget(null)}
          onSaved={() => { setSmartTarget(null); onChanged(); }}
        />
      )}
    </div>
  );
}

// ── 統計分頁 ──────────────────────────────────────────────────────────────────

function StatsView() {
  const [groupBy, setGroupBy] = useState<"class" | "grade" | "user">("class");
  const [data, setData] = useState<OrderSummaryOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [userOptions, setUserOptions] = useState<{ id: string; label: string }[]>([]);
  const [productId, setProductId] = useState("");
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState("");
  const [userId, setUserId] = useState("");
  const [paid, setPaid] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activities, setActivities] = useState<ActivityOut[]>([]);
  const [activityId, setActivityId] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [optionsError, setOptionsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOptionsError(false);
    Promise.all([
      listProductChoices(),
      classApi.recipientOptions(),
      shopApi.orderSummary({ group_by: "user" }),
      shopApi.listActivities(),
    ]).then(([loadedProducts, loadedClasses, userSummary, loadedActivities]) => {
      if (cancelled) return;
      setProducts(loadedProducts);
      setClasses(loadedClasses);
      setActivities(loadedActivities);
      setUserOptions(
        userSummary?.rows
          .filter((row) => row.key !== "none")
          .map((row) => ({ id: row.key, label: row.label })) ?? []
      );
    }).catch(() => { if (!cancelled) setOptionsError(true); });
    return () => { cancelled = true; };
  }, [retryKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    shopApi.orderSummary({
      group_by: groupBy,
      activity_id: activityId,
      product_id: productId,
      grade,
      class_id: classId,
      user_id: userId.trim(),
      status: statusFilter,
      is_paid: paid,
      date_from: dateFrom ? new Date(`${dateFrom}T00:00:00+08:00`).toISOString() : "",
      date_to: dateTo ? new Date(`${dateTo}T23:59:59+08:00`).toISOString() : "",
    })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(apiErrorMessage(e, "統計載入失敗"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activityId, classId, dateFrom, dateTo, grade, groupBy, paid, productId, statusFilter, userId, retryKey]);

  const groupOptions = [
    ["class", "依班級"],
    ["grade", "依年級"],
    ["user", "依個人"],
  ] as const;
  const gradeOptions = Array.from(
    new Set(classes.map((schoolClass) => schoolClass.grade).filter((value) => value !== null))
  ).sort((a, b) => a - b);
  const filteredClasses = classes.filter((schoolClass) =>
    (!grade || String(schoolClass.grade) === grade)
  );
  const resetFilters = () => {
    setActivityId("");
    setProductId("");
    setGrade("");
    setClassId("");
    setUserId("");
    setPaid("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };
  const hasAdvancedFilters = Boolean(
    activityId || productId || grade || classId || userId || paid || statusFilter || dateFrom || dateTo
  );
  const scopeLabels = [
    activities.find((activity) => activity.id === activityId)?.name || "全部活動",
    products.find((product) => product.id === productId)?.name,
    grade && `${grade} 年級`,
    classes.find((schoolClass) => schoolClass.id === classId)?.label,
    userOptions.find((user) => user.id === userId)?.label,
    paid === "true" ? "班聯已確認" : paid === "false" ? "班聯未確認" : "全部收款狀態",
    statusFilter ? { pending: "待確認訂單", confirmed: "已確認訂單", cancelled: "已取消訂單", refunded: "已退款訂單" }[statusFilter] : "排除取消與退款",
    (dateFrom || dateTo) && `${dateFrom || "不限起日"} 至 ${dateTo || "不限迄日"}`,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="活動">
            <select className="input min-h-11 w-full" value={activityId} onChange={(event) => { setActivityId(event.target.value); setProductId(""); }}>
              <option value="">全部活動</option>
              {activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
            </select>
          </Field>
          <Field label="統計方式">
            <select className="input min-h-11 w-full" value={groupBy} onChange={(event) => setGroupBy(event.target.value as "class" | "grade" | "user")}>
              {groupOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <button type="button" className="btn btn-ghost min-h-11" aria-expanded={advancedOpen} aria-controls="shop-stats-filters" onClick={() => setAdvancedOpen((value) => !value)}>
            {advancedOpen ? "收起篩選" : "更多篩選"}
          </button>
          {hasAdvancedFilters && <MiniBtn onClick={resetFilters}>清除篩選</MiniBtn>}
          <button type="button" className="btn btn-ghost min-h-11" disabled={loading} onClick={() => setRetryKey((value) => value + 1)}>重新整理</button>
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>統計範圍：{scopeLabels.join(" · ")}</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>交給班代的款項，需由班聯確認後才計入「班聯已確認」。</p>
        {optionsError && <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
          篩選選項載入失敗。<button type="button" className="btn btn-ghost min-h-11" onClick={() => setRetryKey((value) => value + 1)}>重新載入選項</button>
        </div>}
        {advancedOpen && (
          <div id="shop-stats-filters" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="商品">
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input w-full">
                <option value="">全部商品</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </Field>
            <Field label="年級">
              <select value={grade} onChange={(e) => { setGrade(e.target.value); setClassId(""); }} className="input w-full">
                <option value="">全部年級</option>
                {gradeOptions.map((value) => <option key={value} value={value}>{value} 年級</option>)}
              </select>
            </Field>
            <Field label="班級">
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input w-full">
                <option value="">全部班級</option>
                {filteredClasses.map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>
                    {schoolClass.label || schoolClass.class_code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="訂購人">
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input w-full">
                <option value="">全部訂購人</option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>{user.label}</option>
                ))}
              </select>
            </Field>
            <Field label="班聯收款狀態">
              <select value={paid} onChange={(e) => setPaid(e.target.value)} className="input w-full">
                <option value="">全部</option>
                <option value="true">班聯已確認</option>
                <option value="false">班聯未確認</option>
              </select>
            </Field>
            <Field label="訂單狀態">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-full">
                <option value="">排除取消與退款</option>
                <option value="pending">待確認</option>
                <option value="confirmed">已確認</option>
                <option value="cancelled">已取消</option>
                <option value="refunded">已退款</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="訂購起日">
                <input type="date" max={dateTo || undefined} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input w-full" />
              </Field>
              <Field label="訂購迄日">
                <input type="date" min={dateFrom || undefined} value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input w-full" />
              </Field>
            </div>
          </div>
        )}
      </div>
      {loading && (
        <div role="status" className="card p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          載入統計中…
        </div>
      )}
      {error && (
        <div role="alert" className="card p-4 text-sm" style={{ color: "var(--danger, #e11d48)" }}>
          <p>{error}</p>
          <MiniBtn onClick={() => setRetryKey((value) => value + 1)}>重新載入統計</MiniBtn>
        </div>
      )}
      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "訂購金額", value: data.total_amount },
              { label: "班聯已確認收款", value: data.paid_amount },
              { label: "班聯尚未確認收款", value: data.unpaid_amount },
            ].map(({ label, value }) => (
              <div key={label} className="card p-4 text-center">
                <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                <p className="text-lg font-bold" style={{ color: "var(--primary-text)" }}>
                  NT${value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:hidden">
            {data.rows.length === 0 ? (
              <div className="card p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                <p>目前範圍沒有訂單；可清除篩選或改選其他活動。</p>
                {hasAdvancedFilters && <button type="button" className="btn btn-ghost mt-3 min-h-11" onClick={resetFilters}>查看全部統計</button>}
              </div>
            ) : data.rows.map((r) => (
              <div key={r.key} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{r.label}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {r.order_count} 筆訂單 · {r.item_count} 件
                    </p>
                  </div>
                  <p className="font-bold" style={{ color: "var(--primary-text)" }}>
                    NT${r.total_amount.toLocaleString()}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                    <p style={{ color: "var(--text-muted)" }}>班聯已確認</p>
                    <p className="font-semibold mt-0.5" style={{ color: "var(--success)" }}>NT${r.paid_amount.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                    <p style={{ color: "var(--text-muted)" }}>班聯未確認</p>
                    <p className="font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>NT${r.unpaid_amount.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card overflow-x-auto hidden sm:block">
            <table className="w-full min-w-[680px] text-sm tabular-nums">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {[groupBy === "class" ? "班級" : groupBy === "grade" ? "年級" : "訂購人", "訂單數", "商品件數", "訂購金額", "班聯已確認", "班聯未確認"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold"
                      style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm"
                    style={{ color: "var(--text-muted)" }}>
                    <p>目前範圍沒有訂單；可清除篩選或改選其他活動。</p>
                    {hasAdvancedFilters && <button type="button" className="btn btn-ghost mt-3 min-h-11" onClick={resetFilters}>查看全部統計</button>}
                  </td></tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.key} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{r.label}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{r.order_count}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{r.item_count}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                        NT${r.total_amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--success)" }}>
                        NT${r.paid_amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                        NT${r.unpaid_amount.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── 主頁：一層一層的目錄管理 ──────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿", testing: "測試中", active: "上架中", sold_out: "售罄", cancelled: "已下架",
};

export default function ShopAdminPage() {
  const { can } = usePermissions();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const tab = requestedView === "stats" || requestedView === "promotions" ? requestedView : "catalog";
  const [clearOrdersOpen, setClearOrdersOpen] = useState(false);
  const [clearingOrders, setClearingOrders] = useState(false);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [productStatusBusy, setProductStatusBusy] = useState(false);
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

  const copyOrderLink = async (id: string) => {
    const url = new URL("/shop", window.location.origin);
    url.searchParams.set("product", id);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success("已複製商品訂購連結");
    } catch {
      toast.error("無法複製訂購連結，請確認瀏覽器剪貼簿權限");
    }
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
      .catch((error) => setCatalogError(apiErrorMessage(error, "無法載入商品主題，請重新載入。")))
      .finally(() => setCatalogLoading(false));
  }, []);
  const loadSeries = useCallback((categoryId: string) => {
    shopApi.listSeries({ category_id: categoryId }).then(setSeriesList).catch((error) => {
      setSeriesList([]);
      setCatalogError(apiErrorMessage(error, "無法載入商品系列，請重新載入。"));
    });
  }, []);
  const loadProducts = useCallback((sid: string) => {
    shopApi.listProducts({ series_id: sid }).then(setProducts).catch((error) => {
      setProducts([]);
      toast.error(apiErrorMessage(error, "載入商品清單失敗"));
    });
  }, []);
  const loadDirectProducts = useCallback((categoryId: string) => {
    shopApi.listProducts({ category_id: categoryId }).then(setDirectProducts).catch((error) => {
      setDirectProducts([]);
      toast.error(apiErrorMessage(error, "載入單一商品失敗"));
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
      <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
        <p className="text-sm">需要「管理商品」權限才能存取此頁。</p>
      </div>
    );
  }

  const delCategory = async (c: ProductCategoryOut) => {
    if (!confirm(`確定刪除主題「${c.name}」？主題下必須沒有系列或商品才能刪除。`)) return;
    try {
      await shopApi.deleteCategory(c.id);
      loadCategories();
      if (cat?.id === c.id) selectCategory(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };
  const delSeries = async (s: ProductSeriesOut) => {
    if (!confirm(`確定刪除系列「${s.name}」？系列下必須沒有商品才能刪除。`)) return;
    try {
      await shopApi.deleteSeries(s.id);
      if (cat) loadSeries(cat.id);
      if (series?.id === s.id) selectSeries(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };
  const delProduct = async (p: ProductOut) => {
    if (!confirm(`確定刪除商品「${p.name}」？已有訂單紀錄的商品無法刪除。`)) return;
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
    if (p.status === "testing" && !confirm(
      `正式開放「${p.name}」？將清除這項商品的測試訂單、付款／收款等相關紀錄，並回補庫存。此操作無法復原。`,
    )) return;
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
          ? { background: "var(--primary-dim)", color: "var(--primary)" }
          : { background: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
        <Thumb url={item.image_url} size={34} />
        <span className="flex-1 min-w-0">
          <span className="block break-words text-sm font-medium">{item.name}</span>
          <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
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
    <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>選擇商品即可編輯售價、上架狀態與規格。</div>
  ) : productId && !product ? (
    <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>載入商品詳情中…</div>
  ) : product ? (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-4">
        <Thumb url={product.image_url} size={72} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>商品詳情</p>
          <h2 className="text-xl font-semibold mt-1 break-words" style={{ color: "var(--text-primary)" }}>{product.name}</h2>
          {product.description && (
            <p className="text-sm mt-2 whitespace-pre-line" style={{ color: "var(--text-secondary)" }}>
              {product.description}
            </p>
          )}
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            NT${product.price.toLocaleString()} · {product.is_unlimited ? "無限量" : `庫存 ${product.stock_quantity}`} · {STATUS_LABEL[product.status] ?? product.status}
            {product.effective_sale_end && ` · 截止 ${new Date(product.effective_sale_end).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}${product.sale_end ? "（單品設定）" : "（沿用活動）"}`}
            {product.max_quantity_per_user != null && ` · 每人限購 ${product.max_quantity_per_user} 件`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <MiniBtn tone="primary" onClick={() => setProductModal({ initial: product })}>編輯商品</MiniBtn>
        <MiniBtn disabled={product.status !== "active" && product.status !== "testing"} onClick={() => void copyOrderLink(product.id)}>
          複製訂購連結
        </MiniBtn>
        {can("shop:test") && (product.status === "draft" || product.status === "cancelled") && (
          <MiniBtn disabled={productStatusBusy} onClick={() => void toggleProduct(product, true)}>開始測試</MiniBtn>
        )}
        <MiniBtn disabled={productStatusBusy} onClick={() => void toggleProduct(product)}>
          {productStatusBusy ? "更新中…" : product.status === "testing" ? "正式開放並清除測試資料" : product.status === "active" || product.status === "sold_out" ? "下架" : "上架"}
        </MiniBtn>
      </div>
      {product.status === "testing" && (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          僅超管或具「測試商品」權限者能查看與試訂。正式開放時會清除這項商品的測試訂單及相關紀錄，並回補庫存。
        </p>
      )}
      {productActionError && <p role="alert" className="text-sm" style={{ color: "var(--text-danger)" }}>{productActionError}</p>}
      <VariantManager
        product={product}
        allProducts={allProducts}
        onChanged={() => { loadProduct(product.id); loadAllProducts(); }}
      />
    </div>
  ) : !series ? (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>主題詳情</p>
          <h2 className="text-xl font-semibold mt-1 break-words" style={{ color: "var(--text-primary)" }}>{cat.name}</h2>
          <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>{cat.description || "無描述"}</p>
        </div>
        <Thumb url={cat.image_url} size={72} />
      </div>
      <div className="flex flex-wrap gap-2">
        <MiniBtn tone="primary" onClick={() => setCatModal({ initial: cat })}>編輯主題</MiniBtn>
        <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null, seriesId: null })}>新增單一商品</MiniBtn>
      </div>
    </div>
  ) : (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>系列詳情</p>
          <h2 className="text-xl font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{series.name}</h2>
          <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>{series.description || "無描述"}</p>
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
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{tab === "stats" ? "訂購統計" : tab === "promotions" ? "優惠設定" : "商品設定"}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {tab === "stats" ? "按活動核對訂購金額與班聯收款進度。" : tab === "promotions" ? "設定折扣條件、優惠碼與適用商品。" : "選擇商品主題，新增商品、設定規格並上架。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab !== "catalog" && <Link href="/shop/admin" className="btn btn-secondary min-h-11">返回商品設定</Link>}
          {tab === "catalog" && <Link href="/shop/admin?view=promotions" className="btn btn-secondary min-h-11">設定優惠</Link>}
          {tab === "catalog" && <Link href="/shop" className="btn btn-ghost min-h-11">查看商品頁</Link>}
          {tab === "stats" && <Link href="/shop/council-orders" className="btn btn-ghost min-h-11">返回班聯工作</Link>}
        </div>
      </div>

      {tab === "catalog" && <ActivityDeadlines onSaved={() => {
        loadAllProducts();
        if (productId) loadProduct(productId);
        if (cat) loadDirectProducts(cat.id);
        if (series) loadProducts(series.id);
      }} />}

      {tab === "stats" ? (
        <StatsView key={statsRefreshKey} />
      ) : tab === "promotions" ? (
        <ShopPromotionPanel />
      ) : (
        <div className="card overflow-hidden lg:min-h-[620px]">
          {catalogError && <div role="alert" className="p-4 text-sm" style={{ color: "var(--danger)" }}>
            <p>{catalogError}</p>
            <button type="button" className="btn btn-ghost min-h-11" onClick={() => {
              loadCategories();
              if (cat) { loadSeries(cat.id); loadDirectProducts(cat.id); }
              if (series) loadProducts(series.id);
            }}>重新載入商品目錄</button>
          </div>}
          <div className="grid grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,1.2fr)] lg:min-h-[620px]">
            <aside className="min-w-0 overflow-hidden flex flex-col" style={{ borderRight: "1px solid var(--border)" }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>主題</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{categories.length} 個主題</p>
                </div>
                <MiniBtn tone="primary" onClick={() => setCatModal({ initial: null })}>新增主題</MiniBtn>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {categories.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <button type="button" onClick={() => selectCategory(c)}
                      className="min-h-11 flex-1 min-w-0 flex items-center gap-2 p-2 rounded-lg text-left"
                      style={cat?.id === c.id
                        ? { background: "var(--primary-dim)", color: "var(--primary)" }
                        : { color: "var(--text-secondary)", opacity: c.is_active ? 1 : 0.6 }}>
                      <Thumb url={c.image_url} size={34} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{c.name}</span>
                        <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                          {c.description || "無描述"}
                        </span>
                      </span>
                    </button>
                    <MiniBtn tone="danger" onClick={() => void delCategory(c)}>刪除</MiniBtn>
                  </div>
                ))}
                {catalogLoading && <p role="status" className="p-4 text-sm">正在載入商品主題…</p>}
                {!catalogLoading && !catalogError && categories.length === 0 && <p className="p-4 text-sm" style={{ color: "var(--text-secondary)" }}>尚未建立商品主題。按「新增主題」開始，例如「校慶商品」。</p>}
              </div>
            </aside>

            <section className="min-w-0 overflow-hidden flex flex-col" style={{ borderRight: "1px solid var(--border)" }}>
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>系列與商品</p>
                    <p className="text-sm font-medium truncate mt-0.5" style={{ color: "var(--text-primary)" }}>
                      {cat ? cat.name : "請先選擇主題"}
                    </p>
                  </div>
                  {cat && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs lg:hidden"
                        onClick={() => setMobileDetailOpen(true)}>主題設定</button>
                      <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null, seriesId: null })}>新增單一商品</MiniBtn>
                      <MiniBtn tone="primary" onClick={() => setSeriesModal({ initial: null })}>新增系列</MiniBtn>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {!cat ? (
                  <p className="p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>先選擇商品主題，即可新增或管理商品。</p>
                ) : (
                  <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                    <section className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>單一商品</p>
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>直接放在「{cat.name}」下，不需要建立系列</p>
                        </div>
                      </div>
                      {directProducts.map(productRow)}
                      {directProducts.length === 0 && (
                        <p className="py-2 text-xs" style={{ color: "var(--text-muted)" }}>目前沒有單一商品</p>
                      )}
                    </section>
                    {seriesList.map((s) => (
                      <div key={s.id}>
                        <div className="flex items-center gap-3 px-4 py-3" style={{ background: series?.id === s.id ? "var(--bg-elevated)" : undefined }}>
                          <button type="button" onClick={() => selectSeries(s)} className="flex-1 min-h-11 min-w-0 text-left">
                            <p className="text-sm font-semibold truncate" style={{ color: series?.id === s.id ? "var(--primary)" : "var(--text-primary)" }}>{s.name}</p>
                            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{s.description || "無描述"}</p>
                          </button>
                          <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs lg:hidden"
                            onClick={() => { selectSeries(s); setMobileDetailOpen(true); }}>管理</button>
                          <MiniBtn onClick={() => setSeriesModal({ initial: s })}>編輯</MiniBtn>
                          <MiniBtn tone="danger" onClick={() => void delSeries(s)}>刪除</MiniBtn>
                        </div>
                        {series?.id === s.id && (
                          <div className="px-3 pb-3 space-y-2">
                            <div className="flex justify-end">
                              <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null, seriesId: s.id })}>新增商品</MiniBtn>
                            </div>
                            {products.map(productRow)}
                            {products.length === 0 && <p className="py-4 text-xs text-center" style={{ color: "var(--text-muted)" }}>此系列尚無商品</p>}
                          </div>
                        )}
                      </div>
                    ))}
                    {seriesList.length === 0 && (
                      <p className="p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>
                        此主題尚無系列；可直接新增商品，或建立系列管理多件商品。
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
        <details className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <summary className="min-h-11 cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>訂單資料維護</summary>
          <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>清除會永久刪除所有活動的訂單，包含已收款資料，且無法復原。</p>
          <button type="button" onClick={() => setClearOrdersOpen(true)} className="btn btn-ghost min-h-11" style={{ color: "var(--danger)" }}>
            <Trash2 size={15} /> 清除所有商品訂購資料
          </button>
        </details>
      )}

      {clearOrdersOpen && (
        <Modal title="清除所有商品訂購資料？" onClose={() => {
          if (!clearingOrders) setClearOrdersOpen(false);
        }} size="md">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg p-3"
              style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
              <div className="space-y-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                <p>這會永久刪除所有使用者、所有活動與所有狀態的商品訂單，包含已收款的訂單。</p>
                <p>系統會同步清除訂單明細、商品應收款與尚未寄出的確認通知，並回補訂單占用的庫存及優惠使用次數。</p>
                <p>商品目錄、購物車和稽核紀錄會保留。此動作無法復原。</p>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setClearOrdersOpen(false)} disabled={clearingOrders}
                className="btn btn-ghost min-h-11 px-4 disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void clearAllOrders()} disabled={clearingOrders}
                className="btn min-h-11 px-4 disabled:opacity-50"
                style={{ background: "#b83a30", color: "#fff", border: "none" }}>
                {clearingOrders ? "清除中…" : "確認清除所有訂單"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {mobileDetailOpen && cat && (
        <div className="lg:hidden">
          <Modal
            title={product ? "商品詳情" : series ? "系列詳情" : "主題詳情"}
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
      {productModal && cat && (
        <ProductFormModal
          categoryId={productModal.initial?.category_id ?? cat.id}
          seriesId={productModal.initial?.series_id ?? productModal.seriesId ?? null}
          initial={productModal.initial}
          onClose={() => setProductModal(null)}
          onSaved={(savedProduct) => {
            setProductModal(null);
            if (savedProduct.series_id) {
              setProducts((current) => current.some((item) => item.id === savedProduct.id)
                ? current.map((item) => item.id === savedProduct.id ? savedProduct : item)
                : [savedProduct, ...current]);
            } else {
              setDirectProducts((current) => current.some((item) => item.id === savedProduct.id)
                ? current.map((item) => item.id === savedProduct.id ? savedProduct : item)
                : [savedProduct, ...current]);
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
