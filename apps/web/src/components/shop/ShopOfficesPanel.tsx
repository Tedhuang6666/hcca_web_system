"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ShopOfficeOut } from "@/lib/types";

function OfficeRow({ office, disabled, dragging, sortingDisabled, beginMutation, endMutation, onSaved }: {
  office: ShopOfficeOut;
  disabled: boolean;
  dragging: boolean;
  sortingDisabled: boolean;
  beginMutation: () => boolean;
  endMutation: () => void;
  onSaved: (office: ShopOfficeOut) => void;
}) {
  const [name, setName] = useState(office.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const sortable = useSortable({ id: office.id, disabled: disabled || sortingDisabled });
  const locked = disabled || dragging || busy;

  const save = async (active?: boolean) => {
    if (locked || (active === undefined && !name.trim()) || !beginMutation()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const updated = await shopApi.updateOffice(office.id, active === undefined
        ? { name: name.trim() } : { is_active: active });
      onSaved(updated);
      if (active === undefined) setName(updated.name);
      setMessage(active === undefined ? "名稱已儲存。" : active ? "處室已啟用。" : "處室已停用。");
    } catch (cause) { setError(apiErrorMessage(cause, "處室未更新，請重試。")); }
    finally { setBusy(false); endMutation(); }
  };

  return <li ref={sortable.setNodeRef} className="relative py-4" style={{
    borderBottom: "1px solid var(--border)",
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 1 : undefined,
    background: sortable.isDragging ? "var(--bg-surface)" : undefined,
  }}>
    <div className="flex items-start gap-2 sm:gap-3">
      <button type="button" ref={sortable.setActivatorNodeRef}
        id={`shop-office-handle-${office.id}`}
        {...sortable.attributes} {...sortable.listeners}
        className="btn btn-ghost mt-6 min-h-11 min-w-11 shrink-0 cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }} disabled={disabled || sortingDisabled}
        aria-label={`拖曳排序：${office.name}`} aria-roledescription="可排序處室" title="拖曳更改順序">
        <GripVertical size={20} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="flex-1 min-w-0 basis-52 text-sm" style={{ color: "var(--text-primary)" }}>
            處室名稱
            <input className="input mt-1 w-full min-h-11" aria-label={`${office.name}的名稱`} value={name} maxLength={100} required disabled={locked}
              onChange={(event) => { setName(event.target.value); setMessage(""); }} />
          </label>
          <span className="pb-3 text-sm" style={{ color: "var(--text-secondary)" }}>{office.is_active ? "啟用中" : "已停用"}</span>
          <button type="submit" className="btn btn-secondary min-h-11" disabled={locked || !name.trim() || name.trim() === office.name}>儲存名稱</button>
          <button type="button" className="btn btn-ghost min-h-11" disabled={locked} aria-label={`${office.is_active ? "停用" : "啟用"}${office.name}`}
            onClick={() => void save(!office.is_active)}>{office.is_active ? "停用" : "啟用"}</button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        {message && <p role="status" className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>}
      </div>
    </div>
  </li>;
}

export default function ShopOfficesPanel() {
  const [offices, setOffices] = useState<ShopOfficeOut[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const mutation = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [orderError, setOrderError] = useState("");
  const [message, setMessage] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const beginMutation = () => {
    if (mutation.current) return false;
    mutation.current = true;
    setBusy(true);
    return true;
  };
  const endMutation = () => { mutation.current = false; setBusy(false); };

  const load = useCallback(async () => {
    setLoading(true); setLoadError(""); setOrderError(""); setMessage("");
    try { setOffices(await shopApi.offices()); }
    catch (error) { setLoadError(apiErrorMessage(error, "無法載入處室，請重試。")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (activeId || !name.trim() || !beginMutation()) return;
    setSaveError(""); setMessage("");
    try {
      const office = await shopApi.createOffice({ name: name.trim() });
      form.reset();
      setOffices((rows) => [...rows, office]); setName(""); setMessage(`已新增「${office.name}」。`);
    } catch (error) { setSaveError(apiErrorMessage(error, "處室未新增，請重試。")); }
    finally { endMutation(); }
  };

  const reorder = async ({ active, over, activatorEvent }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const from = offices.findIndex((office) => office.id === active.id);
    const to = offices.findIndex((office) => office.id === over.id);
    if (from < 0 || to < 0 || !beginMutation()) return;
    const previous = offices;
    const ordered = arrayMove(offices, from, to);
    setOffices(ordered); setOrdering(true); setOrderError(""); setMessage("");
    try {
      setOffices(await shopApi.reorderOffices({ office_ids: ordered.map((office) => office.id) }));
      setMessage("處室順序已儲存。");
    } catch (error) {
      setOffices(previous);
      setOrderError(apiErrorMessage(error, "無法儲存處室順序，已還原畫面，請重新拖曳或重新載入確認。"));
    } finally {
      setOrdering(false); endMutation();
      if (activatorEvent instanceof KeyboardEvent) {
        requestAnimationFrame(() => {
          document.getElementById(`shop-office-handle-${active.id}`)?.focus({ preventScroll: true });
        });
      }
    }
  };
  const officeName = (id: string | number) => offices.find((office) => office.id === id)?.name ?? "處室";

  return <section className="max-w-3xl" aria-label="教師處室選項管理">
    <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>教師處室選項</h2>
    <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>老師可在商品頁選擇這些辦公室／處室。停用後不再提供選取，既有訂單保留原名稱。</p>
    <p id="office-sort-help" className="mt-2 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>拖曳把手排序，自動儲存；鍵盤可用空白鍵拿起／放下、上下鍵移動。</p>
    {loading ? <p className="mt-4" role="status">正在載入處室…</p> : loadError ? <div className="mt-4" role="alert">
      <p>{loadError}</p><button type="button" className="btn btn-secondary min-h-11 mt-2" onClick={() => void load()}>重新載入處室</button>
    </div> : <>
      <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={create}>
        <label className="flex-1 min-w-0 basis-52 text-sm" style={{ color: "var(--text-primary)" }}>新增處室名稱
          <input className="input mt-1 w-full min-h-11" placeholder="例如：國文科、學務處" maxLength={100} required value={name} disabled={busy || activeId !== null}
            onChange={(event) => { setName(event.target.value); setMessage(""); }} />
        </label>
        <button type="submit" className="btn btn-primary min-h-11" disabled={busy || activeId !== null || !name.trim()}>新增處室</button>
      </form>
      {saveError && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{saveError}</p>}
      {ordering && <p role="status" className="mt-2 text-sm">正在儲存處室順序…</p>}
      {orderError && <div role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
        <p>{orderError}</p>
        <button type="button" className="btn btn-secondary min-h-11 mt-2" disabled={busy} onClick={() => void load()}>重新載入處室</button>
        <p className="mt-1" style={{ color: "var(--text-secondary)" }}>重新載入會清除尚未儲存的名稱。</p>
      </div>}
      {message && <p role="status" className="mt-2 text-sm">{message}</p>}
      {offices.length === 0 ? <p className="mt-6 text-sm">尚未設定處室，請先新增老師可選的選項。</p>
        : <DndContext id="shop-offices" sensors={sensors} collisionDetection={closestCenter}
          onDragStart={({ active }) => { setActiveId(String(active.id)); setMessage(""); }}
          onDragEnd={(event) => void reorder(event)} onDragCancel={() => setActiveId(null)}
          accessibility={{
            screenReaderInstructions: { draggable: "按空白鍵或 Enter 拿起處室，使用上下方向鍵移動，再按空白鍵或 Enter 放下，按 Escape 取消。" },
            announcements: {
              onDragStart: ({ active }) => `已拿起「${officeName(active.id)}」。`,
              onDragOver: ({ active, over }) => over
                ? `「${officeName(active.id)}」將移至第 ${offices.findIndex((office) => office.id === over.id) + 1} 個位置。`
                : "已移出處室清單。",
              onDragEnd: ({ active, over }) => over && active.id !== over.id
                ? `已放下「${officeName(active.id)}」，正在儲存順序。` : "順序未變更。",
              onDragCancel: () => "已取消拖曳，順序未變更。",
            },
          }}>
          <SortableContext items={offices.map((office) => office.id)} strategy={verticalListSortingStrategy}>
            <ul className="mt-4" aria-label="處室排序清單">{offices.map((office) => <OfficeRow key={office.id} office={office}
              disabled={busy} dragging={activeId !== null} sortingDisabled={offices.length < 2}
              beginMutation={beginMutation} endMutation={endMutation}
              onSaved={(updated) => setOffices((rows) => rows.map((row) => row.id === updated.id ? updated : row))} />)}</ul>
          </SortableContext>
        </DndContext>}
    </>}
  </section>;
}
