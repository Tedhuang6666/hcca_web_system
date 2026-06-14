"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { activitiesApi, shopApi, classApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import Modal from "@/components/ui/Modal";
import ActivitySelect from "@/components/activities/ActivitySelect";
import type {
  SchoolClassListItem,
  ProductCategoryOut,
  ProductSeriesOut,
  ProductOut,
  ProductVariantGroupOut,
  ProductVariantOptionOut,
  OrderSummaryOut,
  Activity,
} from "@/lib/types";

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
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const { url } = await shopApi.uploadImage(file);
      onChange(url);
    } catch (e) {
      toast.error(apiErrorMessage(e, "上傳失敗"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <Thumb url={value} size={48} />
      <label className="btn btn-ghost text-xs cursor-pointer">
        {busy ? "上傳中…" : value ? "更換圖片" : "上傳圖片"}
        <input type="file" accept="image/*" className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
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
    primary: { color: "var(--primary)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" },
    danger: { color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" },
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-45"
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
    kind === "category" ? ((initial as ProductCategoryOut | null)?.activity_id ?? "") : "",
  );
  const [busy, setBusy] = useState(false);

  const label = kind === "category" ? "主題" : "系列";

  return (
    <Modal title={`${editing ? "編輯" : "新增"}${label}`} onClose={onClose} size="md">
      <div className="space-y-3">
        <Field label="名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full"
            placeholder={kind === "category" ? "如：校商" : "如：衣服系列"} />
        </Field>
        <Field label="描述（選填）">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input w-full" />
        </Field>
        <Field label="圖片">
          <ImageField value={imageUrl} onChange={setImageUrl} />
        </Field>
        {kind === "category" && (
          <ActivitySelect value={activityId} onChange={setActivityId} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="排序">
            <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input w-full" inputMode="numeric" />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            啟用
          </label>
        </div>
        <div className="flex gap-3 pt-1">
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
                  sort_order: Number(sortOrder) || 0,
                  is_active: isActive,
                };
                if (kind === "category") {
                  if (editing) await shopApi.updateCategory(initial!.id, { ...body, activity_id: activityId || null });
                  else {
                    await shopApi.createCategory({ ...body, activity_id: activityId || null });
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

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ProductFormModal({
  seriesId,
  initial,
  onClose,
  onSaved,
}: {
  seriesId: string;
  initial: ProductOut | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial !== null;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [price, setPrice] = useState(String(initial?.price ?? 0));
  const [stock, setStock] = useState(String(initial?.stock_quantity ?? 0));
  const [unlimited, setUnlimited] = useState(initial?.is_unlimited ?? false);
  const [saleEnd, setSaleEnd] = useState(toLocalInput(initial?.sale_end ?? null));
  const [requiresSeating, setRequiresSeating] = useState(initial?.requires_seating ?? false);
  const [seatingMode, setSeatingMode] = useState<string>(initial?.seating_mode ?? "at_purchase");
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={`${editing ? "編輯" : "新增"}商品`} onClose={onClose} size="md">
      <div className="space-y-3">
        <Field label="商品名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
        </Field>
        <Field label="商品描述（選填）">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input w-full" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="售價">
            <input value={price} onChange={(e) => setPrice(e.target.value)} className="input w-full" inputMode="numeric" />
          </Field>
          <Field label="庫存">
            <input value={stock} onChange={(e) => setStock(e.target.value)} disabled={unlimited}
              className="input w-full" inputMode="numeric" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
          無限量供應
        </label>
        <Field label="截止時間（選填）">
          <input type="datetime-local" value={saleEnd} onChange={(e) => setSaleEnd(e.target.value)}
            className="input w-full" />
        </Field>
        <Field label="商品圖片">
          <ImageField value={imageUrl} onChange={setImageUrl} />
        </Field>
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
          {editing ? "尺寸 / 顏色等變體於商品詳情頁管理。" : "建立後可於商品詳情頁新增尺寸 / 顏色等變體。"}
        </p>
        <div className="flex gap-3 pt-1">
          <button disabled={busy} onClick={async () => {
            if (!name.trim()) { toast.error("請輸入商品名稱"); return; }
            setBusy(true);
            try {
              const body = {
                name: name.trim(),
                description: description.trim() || null,
                image_url: imageUrl,
                price: Number(price) || 0,
                stock_quantity: Number(stock) || 0,
                is_unlimited: unlimited,
                sale_end: saleEnd ? new Date(saleEnd).toISOString() : null,
                requires_seating: requiresSeating,
                seating_mode: requiresSeating ? seatingMode : null,
              };
              if (editing) await shopApi.updateProduct(initial!.id, body);
              else await shopApi.createProduct({ ...body, series_id: seriesId });
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
      toast.error("請輸入變體群組名稱");
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
      toast.success("變體群組已儲存");
      onSaved();
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${editing ? "編輯" : "新增"}變體群組`} onClose={onClose} size="md">
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

// ── 變體管理（一個商品下的多個變體群組） ────────────────────────────────────

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
    if (!confirm(`確定刪除變體群組「${g.name}」？`)) return;
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
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          變體群組（{product.variant_groups.length}）
        </p>
        <MiniBtn tone="primary" onClick={() => setGroupModal("new")}>+ 新增變體群組</MiniBtn>
      </div>
      {product.variant_groups.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          尚無變體。可新增多個群組（例如「顏色」與「尺寸」），購買時每個群組需各選一項。
        </p>
      ) : (
        product.variant_groups.map((g) => (
          <div key={g.id} className="rounded-lg p-3 space-y-2"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{g.name}</p>
              <div className="flex gap-1.5">
                <MiniBtn tone="primary" onClick={() => setSmartTarget(g)}>智慧新增</MiniBtn>
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
                    className="px-1" style={{ color: "var(--text-muted)" }} aria-label="編輯選項">✎</button>
                  <button onClick={() => removeOption(o)}
                    className="px-1" style={{ color: "var(--text-muted)" }} aria-label="刪除選項">×</button>
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

function StatsView({ activityId }: { activityId: string }) {
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

  useEffect(() => {
    Promise.all([
      shopApi.listProducts({ limit: "100", activity_id: activityId }).catch(() => []),
      classApi.list({ limit: "500" }).catch(() => []),
      shopApi.orderSummary({ group_by: "user", activity_id: activityId }).catch(() => null),
    ]).then(([loadedProducts, loadedClasses, userSummary]) => {
      setProducts(loadedProducts);
      setClasses(loadedClasses);
      setUserOptions(
        userSummary?.rows
          .filter((row) => row.key !== "none")
          .map((row) => ({ id: row.key, label: row.label })) ?? []
      );
    });
  }, [activityId]);

  useEffect(() => {
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
      date_from: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : "",
      date_to: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : "",
    })
      .then(setData)
      .catch((e) => {
        setData(null);
        setError(apiErrorMessage(e, "統計載入失敗"));
      })
      .finally(() => setLoading(false));
  }, [activityId, classId, dateFrom, dateTo, grade, groupBy, paid, productId, statusFilter, userId]);

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
    productId || grade || classId || userId || paid || statusFilter || dateFrom || dateTo
  );

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {!advancedOpen ? (
            <>
              <div className="hidden sm:flex gap-0.5 p-1 rounded-xl w-fit"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                {groupOptions.map(([k, label]) => (
                  <button key={k} onClick={() => setGroupBy(k)}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium"
                    style={groupBy === k
                      ? { background: "var(--primary-dim)", color: "var(--primary)" }
                      : { color: "var(--text-muted)" }}>
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as "class" | "grade" | "user")}
                className="input w-full sm:hidden"
              >
                {groupOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <MiniBtn tone={hasAdvancedFilters ? "primary" : "neutral"} onClick={() => setAdvancedOpen(true)}>
                進階篩選{hasAdvancedFilters ? "（已套用）" : ""}
              </MiniBtn>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>進階篩選</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  可疊加商品、年級、班級、個人與日期條件。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <MiniBtn onClick={() => setAdvancedOpen(false)}>返回簡易篩選</MiniBtn>
                <MiniBtn onClick={resetFilters}>清除篩選</MiniBtn>
              </div>
            </>
          )}
        </div>
        {advancedOpen && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="彙總方式">
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "class" | "grade" | "user")} className="input w-full">
                {groupOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </Field>
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
            <Field label="特定使用者">
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input w-full">
                <option value="">全部使用者</option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>{user.label}</option>
                ))}
              </select>
            </Field>
            <Field label="繳費狀態">
              <select value={paid} onChange={(e) => setPaid(e.target.value)} className="input w-full">
                <option value="">全部</option>
                <option value="true">已繳</option>
                <option value="false">未繳</option>
              </select>
            </Field>
            <Field label="訂單狀態">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-full">
                <option value="">排除已取消</option>
                <option value="pending">待確認</option>
                <option value="confirmed">已確認</option>
                <option value="cancelled">已取消</option>
                <option value="refunded">已退款</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="起日">
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input w-full" />
              </Field>
              <Field label="迄日">
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input w-full" />
              </Field>
            </div>
          </div>
        )}
      </div>
      {loading && (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          載入統計中…
        </div>
      )}
      {error && (
        <div className="card p-4 text-sm" style={{ color: "var(--danger, #e11d48)" }}>
          {error}
        </div>
      )}
      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "總金額", value: data.total_amount },
              { label: "已繳金額", value: data.paid_amount },
              { label: "未繳金額", value: data.unpaid_amount },
            ].map(({ label, value }) => (
              <div key={label} className="card p-4 text-center">
                <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                <p className="text-lg font-bold" style={{ color: "var(--primary)" }}>
                  NT${value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:hidden">
            {data.rows.length === 0 ? (
              <div className="card p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                尚無訂單資料
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
                  <p className="font-bold" style={{ color: "var(--primary)" }}>
                    NT${r.total_amount.toLocaleString()}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                    <p style={{ color: "var(--text-muted)" }}>已繳</p>
                    <p className="font-semibold mt-0.5" style={{ color: "#16a34a" }}>NT${r.paid_amount.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                    <p style={{ color: "var(--text-muted)" }}>未繳</p>
                    <p className="font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>NT${r.unpaid_amount.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card overflow-hidden hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["項目", "訂單數", "件數", "總額", "已繳", "未繳"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold"
                      style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm"
                    style={{ color: "var(--text-muted)" }}>尚無訂單資料</td></tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.key} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{r.label}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{r.order_count}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{r.item_count}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                        NT${r.total_amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3" style={{ color: "#16a34a" }}>
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
  draft: "草稿", active: "上架中", sold_out: "售罄", cancelled: "已下架",
};

export default function ShopAdminPage() {
  const { can } = usePermissions();

  const [tab, setTab] = useState<"catalog" | "stats">("catalog");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityId, setActivityId] = useState("");
  const allowed = can("shop:manage") || activities.length > 0;

  // 一層一層的選取狀態
  const [cat, setCat] = useState<ProductCategoryOut | null>(null);
  const [series, setSeries] = useState<ProductSeriesOut | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // 各層資料
  const [categories, setCategories] = useState<ProductCategoryOut[]>([]);
  const [seriesList, setSeriesList] = useState<ProductSeriesOut[]>([]);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [allProducts, setAllProducts] = useState<ProductOut[]>([]);
  const [product, setProduct] = useState<ProductOut | null>(null);

  // Modal
  const [catModal, setCatModal] = useState<{ initial: ProductCategoryOut | null } | null>(null);
  const [seriesModal, setSeriesModal] = useState<{ initial: ProductSeriesOut | null } | null>(null);
  const [productModal, setProductModal] = useState<{ initial: ProductOut | null } | null>(null);

  const loadCategories = useCallback(() => {
    shopApi
      .listCategories(activityId ? { activity_id: activityId } : undefined)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [activityId]);
  const loadSeries = useCallback((categoryId: string) => {
    shopApi.listSeries({ category_id: categoryId }).then(setSeriesList).catch(() => setSeriesList([]));
  }, []);
  const loadProducts = useCallback((sid: string) => {
    shopApi.listProducts({ series_id: sid }).then(setProducts).catch(() => setProducts([]));
  }, []);
  const loadAllProducts = useCallback(() => {
    shopApi.listProducts({ limit: "100", activity_id: activityId }).then(setAllProducts).catch(() => setAllProducts([]));
  }, [activityId]);
  const loadProduct = useCallback((pid: string) => {
    shopApi.getProduct(pid).then(setProduct).catch(() => setProduct(null));
  }, []);

  useEffect(() => {
    activitiesApi.mine(true).then(setActivities).catch(() => setActivities([]));
    shopApi
      .listCategories(activityId ? { activity_id: activityId } : undefined)
      .then(setCategories)
      .catch(() => setCategories([]));
    if (!allowed) return;
    loadCategories();
    loadAllProducts();
  }, [activityId, allowed, loadAllProducts, loadCategories]);

  useEffect(() => { if (cat) loadSeries(cat.id); }, [cat, loadSeries]);
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
    if (!confirm(`確定刪除主題「${c.name}」？`)) return;
    try {
      await shopApi.deleteCategory(c.id);
      loadCategories();
      if (cat?.id === c.id) selectCategory(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };
  const delSeries = async (s: ProductSeriesOut) => {
    if (!confirm(`確定刪除系列「${s.name}」？`)) return;
    try {
      await shopApi.deleteSeries(s.id);
      if (cat) loadSeries(cat.id);
      if (series?.id === s.id) selectSeries(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };
  const toggleProduct = async (p: ProductOut) => {
    try {
      if (p.status === "draft" || p.status === "cancelled") await shopApi.activateProduct(p.id);
      else await shopApi.deactivateProduct(p.id);
      if (series) loadProducts(series.id);
      if (productId === p.id) loadProduct(p.id);
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    }
  };
  const selectCategory = (next: ProductCategoryOut | null) => {
    setCat(next);
    setSeries(null);
    setProductId(null);
    setProduct(null);
    setProducts([]);
    setSeriesList([]);
    if (next && typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileDetailOpen(true);
    }
  };
  const selectSeries = (next: ProductSeriesOut | null) => {
    setSeries(next);
    setProductId(null);
    setProduct(null);
    setProducts([]);
    if (next && typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileDetailOpen(true);
    }
  };
  const selectProduct = (nextProductId: string) => {
    setProductId(nextProductId);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileDetailOpen(true);
    }
  };

  const detailContent = !cat ? (
    <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>選擇主題後，可在右側編輯主題、系列、商品與多組變體。</div>
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
        <MiniBtn tone="danger" onClick={() => delCategory(cat)}>刪除主題</MiniBtn>
      </div>
    </div>
  ) : productId && !product ? (
    <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>載入商品詳情中…</div>
  ) : product ? (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-4">
        <Thumb url={product.image_url} size={72} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>商品詳情</p>
          <h2 className="text-xl font-semibold mt-1 break-words" style={{ color: "var(--text-primary)" }}>{product.name}</h2>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            NT${product.price.toLocaleString()} · {product.is_unlimited ? "無限量" : `庫存 ${product.stock_quantity}`} · {STATUS_LABEL[product.status] ?? product.status}
            {product.sale_end && ` · 截止 ${new Date(product.sale_end).toLocaleString("zh-TW")}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <MiniBtn tone="primary" onClick={() => setProductModal({ initial: product })}>編輯商品</MiniBtn>
        <MiniBtn onClick={() => toggleProduct(product)}>{product.status === "active" || product.status === "sold_out" ? "下架" : "上架"}</MiniBtn>
      </div>
      <VariantManager
        product={product}
        allProducts={allProducts}
        onChanged={() => { loadProduct(product.id); loadAllProducts(); }}
      />
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
        <MiniBtn tone="danger" onClick={() => delSeries(series)}>刪除系列</MiniBtn>
        <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null })}>新增商品</MiniBtn>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>校商後台</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            逐層管理主題 → 系列 → 商品 → 變體
          </p>
        </div>
        <Link href="/shop/orders" className="btn btn-ghost">訂單記錄</Link>
      </div>

      <div className="flex gap-0.5 p-1 rounded-xl w-fit"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        {([["catalog", "商品目錄"], ["stats", "訂購統計"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-4 py-1.5 rounded-lg text-xs font-medium"
            style={tab === k
              ? { background: "var(--primary-dim)", color: "var(--primary)" }
              : { color: "var(--text-muted)" }}>
            {label}
          </button>
        ))}
      </div>

      <div className="card p-4">
        <ActivitySelect
          value={activityId}
          onChange={(next) => {
            setActivityId(next);
            selectCategory(null);
          }}
          label="活動篩選"
          noneLabel="全部商品主題"
          scope="all"
          onActivitiesLoaded={setActivities}
        />
      </div>

      {tab === "stats" ? (
        <StatsView activityId={activityId} />
      ) : (
        <div className="card overflow-hidden min-h-[620px]">
          <div className="grid grid-cols-1 lg:grid-cols-[240px_360px_1fr] min-h-[620px]">
            <aside className="overflow-hidden flex flex-col" style={{ borderRight: "1px solid var(--border)" }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>主題</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{categories.length} 個主題</p>
                </div>
                <MiniBtn tone="primary" onClick={() => setCatModal({ initial: null })}>新增</MiniBtn>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {categories.map((c) => (
                  <button key={c.id} onClick={() => selectCategory(c)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg text-left"
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
                ))}
                {categories.length === 0 && <p className="p-4 text-sm text-center" style={{ color: "var(--text-muted)" }}>尚無主題</p>}
              </div>
            </aside>

            <section className="overflow-hidden flex flex-col" style={{ borderRight: "1px solid var(--border)" }}>
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>系列與商品</p>
                    <p className="text-sm font-medium truncate mt-0.5" style={{ color: "var(--text-primary)" }}>
                      {cat ? cat.name : "請先選擇主題"}
                    </p>
                  </div>
                  {cat && <MiniBtn tone="primary" onClick={() => setSeriesModal({ initial: null })}>新增系列</MiniBtn>}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {!cat ? (
                  <p className="p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>從左側選一個主題開始管理。</p>
                ) : (
                  <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {seriesList.map((s) => (
                      <div key={s.id}>
                        <div className="flex items-center gap-3 px-4 py-3" style={{ background: series?.id === s.id ? "var(--bg-elevated)" : undefined }}>
                          <button onClick={() => selectSeries(s)} className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-semibold truncate" style={{ color: series?.id === s.id ? "var(--primary)" : "var(--text-primary)" }}>{s.name}</p>
                            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{s.description || "無描述"}</p>
                          </button>
                          <MiniBtn onClick={() => setSeriesModal({ initial: s })}>編輯</MiniBtn>
                        </div>
                        {series?.id === s.id && (
                          <div className="px-3 pb-3 space-y-2">
                            <div className="flex justify-end">
                              <MiniBtn tone="primary" onClick={() => setProductModal({ initial: null })}>新增商品</MiniBtn>
                            </div>
                            {products.map((p) => (
                              <button key={p.id} onClick={() => selectProduct(p.id)}
                                className="w-full flex items-center gap-2 rounded-lg p-2 text-left"
                                style={productId === p.id
                                  ? { background: "var(--primary-dim)", color: "var(--primary)" }
                                  : { background: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                                <Thumb url={p.image_url} size={34} />
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm font-medium truncate">{p.name}</span>
                                  <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                                    NT${p.price.toLocaleString()} · {STATUS_LABEL[p.status] ?? p.status} · {p.variant_groups.length} 組變體
                                  </span>
                                </span>
                              </button>
                            ))}
                            {products.length === 0 && <p className="py-4 text-xs text-center" style={{ color: "var(--text-muted)" }}>此系列尚無商品</p>}
                          </div>
                        )}
                      </div>
                    ))}
                    {seriesList.length === 0 && <p className="p-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>此主題尚無系列</p>}
                  </div>
                )}
              </div>
            </section>

            <section className="hidden lg:block overflow-y-auto">
              {detailContent}
            </section>
          </div>
        </div>
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
      {productModal && series && (
        <ProductFormModal seriesId={series.id} initial={productModal.initial}
          onClose={() => setProductModal(null)}
          onSaved={() => {
            setProductModal(null);
            loadProducts(series.id);
            if (productId) loadProduct(productId);
          }} />
      )}
    </div>
  );
}
