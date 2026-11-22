"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ProductVariantGroupOut, ProductVariantOptionOut } from "@/lib/types";
import type { SmartOptionDraft, SmartSourceGroup } from "@/lib/shop-admin-options";
import Modal from "@/components/ui/Modal";
import { Field } from "@/components/shop/admin/ShopAdminFormFields";
import { ImageField, Thumb } from "@/components/shop/admin/ShopAdminMediaFields";
import { parseSmartOptionsText, uniqueSmartOptions } from "@/lib/shop-admin-options";

function SortableOption({
  option,
  disabled,
  onEdit,
  onDelete,
}: {
  option: ProductVariantOptionOut;
  disabled: boolean;
  onEdit: (option: ProductVariantOptionOut) => void;
  onDelete: (option: ProductVariantOptionOut) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.id, disabled });

  return (
    <div
      ref={setNodeRef}
      className="inline-flex items-center gap-1.5 rounded-lg pl-2 pr-1 py-1 text-xs"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
    >
      {option.image_url && <Thumb url={option.image_url} size={20} />}
      <span style={{ color: "var(--text-primary)" }}>{option.value}</span>
      {option.price_delta !== 0 && (
        <span style={{ color: "var(--primary-text)" }}>
          {option.price_delta > 0 ? `+${option.price_delta}` : option.price_delta}
        </span>
      )}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        className="inline-flex min-h-11 min-w-11 touch-none cursor-grab items-center justify-center rounded-md active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait"
        style={{ color: "var(--text-muted)", outlineColor: "var(--primary)" }}
        aria-label={`拖曳調整${option.value}順序`}
        title="拖曳調整順序"
      >
        <GripVertical size={14} aria-hidden />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onEdit(option)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center"
        style={{ color: "var(--text-muted)" }}
        aria-label={`編輯${option.value}`}
      >
        <Pencil size={14} aria-hidden />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDelete(option)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center"
        style={{ color: "var(--text-muted)" }}
        aria-label={`刪除${option.value}`}
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}

export function VariantOptionList({
  options,
  disabled,
  onReorder,
  onEdit,
  onDelete,
  onAdd,
}: {
  options: ProductVariantOptionOut[];
  disabled: boolean;
  onReorder: (options: ProductVariantOptionOut[]) => Promise<boolean>;
  onEdit: (option: ProductVariantOptionOut) => void;
  onDelete: (option: ProductVariantOptionOut) => void;
  onAdd: () => void;
}) {
  const [displayOptions, setDisplayOptions] = useState(options);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    setDisplayOptions(options);
  }, [options]);

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || disabled) return;
    const fromIndex = displayOptions.findIndex((option) => option.id === active.id);
    const toIndex = displayOptions.findIndex((option) => option.id === over.id);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const reordered = arrayMove(displayOptions, fromIndex, toIndex);
    setDisplayOptions(reordered);
    if (!(await onReorder(reordered))) setDisplayOptions(options);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext
        items={displayOptions.map((option) => option.id)}
        strategy={rectSortingStrategy}
      >
        <div className="flex flex-wrap gap-2">
          {displayOptions.map((option) => (
            <SortableOption
              key={option.id}
              option={option}
              disabled={disabled}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={onAdd}
            className="min-h-11 rounded-lg px-2 text-xs disabled:opacity-45"
            style={{ color: "var(--primary-text)", border: "1px dashed var(--border-strong)" }}
          >
            + 選項
          </button>
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function OptionModal({
  groupId,
  initial,
  sortOrder,
  photos,
  onClose,
  onSaved,
}: {
  groupId: string;
  initial: ProductVariantOptionOut | null;
  sortOrder: number;
  photos: { image_url: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial !== null;
  const [value, setValue] = useState(initial?.value ?? "");
  const [priceDelta, setPriceDelta] = useState(String(initial?.price_delta ?? 0));
  const [originalDelta, setOriginalDelta] = useState(initial?.original_price_delta == null ? "" : String(initial.original_price_delta));
  const [priceError, setPriceError] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  return (
    <Modal title={`${editing ? "編輯" : "新增"}選項`} onClose={() => { if (!busy && !uploading) onClose(); }} size="sm">
      <div className="space-y-3">
        <Field label="選項值">
          <input value={value} onChange={(e) => setValue(e.target.value)} className="input w-full"
            placeholder="如：黑、中、XL" />
        </Field>
        <Field label="原始加價（選填）">
          <input type="number" step={1} value={originalDelta} onChange={(e) => setOriginalDelta(e.target.value)} className="input w-full" inputMode="numeric"
            aria-invalid={!!priceError || undefined} aria-describedby={priceError ? "shop-option-price-error" : undefined} />
        </Field>
        <Field label="優惠後加價（可為 0 或負數）">
          <input type="number" step={1} value={priceDelta} onChange={(e) => setPriceDelta(e.target.value)} className="input w-full" inputMode="numeric"
            aria-invalid={!!priceError || undefined} aria-describedby={priceError ? "shop-option-price-error" : undefined} />
        </Field>
        {priceError && <p id="shop-option-price-error" role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{priceError}</p>}
        <Field label="選項圖片（選填）">
          <ImageField value={imageUrl} onChange={setImageUrl} onUploadingChange={setUploading} disabled={busy || uploading} />
        </Field>
        {photos.length > 0 && <Field label="使用商品照片">
          <select className="input w-full" disabled={busy || uploading} value={photos.some((photo) => photo.image_url === imageUrl) ? imageUrl! : ""}
            onChange={(event) => setImageUrl(event.target.value || null)}>
            <option value="">不使用商品照片</option>
            {photos.map((photo) => <option key={photo.image_url} value={photo.image_url}>{photo.label}</option>)}
          </select>
        </Field>}
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>購買者點選此選項時，會自動切換到這張圖片。</p>
        <div className="flex gap-3 pt-1">
          <button disabled={busy || uploading} onClick={async () => {
            if (!value.trim()) { toast.error("請輸入選項值"); return; }
            const current = Number(priceDelta);
            const original = originalDelta.trim() ? Number(originalDelta) : null;
            if (!priceDelta.trim() || !Number.isSafeInteger(current)
              || (original !== null && (!Number.isSafeInteger(original) || original < current))) {
              setPriceError("加價須為整數，原始加價不得低於優惠後加價；原始加價可留空。");
              return;
            }
            setPriceError("");
            setBusy(true);
            try {
              const body = {
                value: value.trim(),
                price_delta: current,
                original_price_delta: original,
                image_url: imageUrl,
                sort_order: sortOrder,
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
            {uploading ? "圖片上傳中…" : busy ? "儲存中…" : "儲存"}
          </button>
          <button disabled={busy || uploading} onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </Modal>
  );
}

export function VariantGroupModal({
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
          original_price_delta: option.original_price_delta,
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

export function SmartOptionsModal({
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
  const nextSortOrder = Math.max(-1, ...target.options.map((option) => option.sort_order)) + 1;

  const source = sources.find((group) => group.id === sourceGroupId);
  const copiedOptions: SmartOptionDraft[] = source?.options.map((option) => ({
    value: option.value,
    price_delta: includePrice ? option.price_delta : 0,
    original_price_delta: includePrice ? option.original_price_delta : null,
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
          original_price_delta: option.original_price_delta,
          image_url: option.image_url,
          sort_order: nextSortOrder + index,
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
