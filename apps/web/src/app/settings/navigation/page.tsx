"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import NavIcon from "@/components/layout/NavIcon";
import {
  DEFAULT_NAV_PREFERENCES,
  filterNavItems,
  NAV_ITEMS_BY_ID,
  readNavPreferences,
  writeNavPreferences,
  type NavItem,
  type NavPreferences,
} from "@/lib/navigation";

type Surface = "desktop" | "mobile";

export default function NavigationSettingsPage() {
  const [prefs, setPrefs] = useState<NavPreferences>(() => readNavPreferences());
  const [surface, setSurface] = useState<Surface>("desktop");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPrefs(readNavPreferences());
    setReady(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const permissionHelpers = useMemo(() => {
    if (typeof window === "undefined") return { can: () => false, hasPrefix: () => false };
    const superuser =
      localStorage.getItem("is_superuser") === "true" || localStorage.getItem("is_owner") === "true";
    let permissions = new Set<string>();
    try {
      permissions = new Set(JSON.parse(localStorage.getItem("permissions") || "[]"));
    } catch { /* ignore */ }
    return {
      can: (code: string) => superuser || permissions.has("admin:all") || permissions.has(code),
      hasPrefix: (prefix: string) =>
        superuser || permissions.has("admin:all") || Array.from(permissions).some((p) => p.startsWith(prefix)),
    };
    // ready 翻 true（掛載後）刻意觸發重算，從 localStorage 取得真正權限；body 未直接引用故停用規則。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const orderKey = surface === "desktop" ? "desktopOrder" : "mobileOrder";
  const hiddenKey = surface === "desktop" ? "desktopHidden" : "mobileHidden";
  const availableItems = useMemo(
    () =>
      filterNavItems(
        prefs[orderKey].map((id) => NAV_ITEMS_BY_ID[id]).filter((item): item is NavItem => !!item),
        permissionHelpers.can,
        permissionHelpers.hasPrefix,
      ),
    [orderKey, permissionHelpers, prefs],
  );
  const hidden = new Set(prefs[hiddenKey]);
  const visibleCount = availableItems.filter((item) => !hidden.has(item.id)).length;

  const updatePrefs = (next: NavPreferences, message = "導覽設定已更新") => {
    setPrefs(next);
    writeNavPreferences(next);
    toast.success(message);
  };

  const setOrder = (order: string[]) => updatePrefs({ ...prefs, [orderKey]: order }, "排序已更新");

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = prefs[orderKey].indexOf(String(active.id));
    const newIndex = prefs[orderKey].indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setOrder(arrayMove(prefs[orderKey], oldIndex, newIndex));
  };

  const toggle = (id: string) => {
    const current = new Set(prefs[hiddenKey]);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    updatePrefs({ ...prefs, [hiddenKey]: Array.from(current) });
  };

  const reset = () => updatePrefs(DEFAULT_NAV_PREFERENCES, "已恢復預設導覽");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            INTERFACE
          </p>
          <h1 className="mt-1 text-xl font-semibold">介面導覽設定</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            調整左側側邊欄與手機底部欄位的顯示項目和排序
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          <RotateCcw size={15} aria-hidden={true} />
          重設預設
        </button>
      </header>

      <section className="card overflow-hidden">
        <div
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold">導覽項目</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              目前顯示 {visibleCount} 個項目；手機底欄會使用前 4 個可顯示項目
            </p>
          </div>
          <div className="inline-flex rounded-md p-1" style={{ border: "1px solid var(--border)" }}>
            <TabButton active={surface === "desktop"} onClick={() => setSurface("desktop")}>
              左側欄
            </TabButton>
            <TabButton active={surface === "mobile"} onClick={() => setSurface("mobile")}>
              手機底欄
            </TabButton>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={prefs[orderKey]} strategy={verticalListSortingStrategy}>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {availableItems.map((item) => (
                <SortableNavRow
                  key={item.id}
                  item={item}
                  visible={!hidden.has(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded px-3 py-1.5 text-sm transition-colors"
      onClick={onClick}
      style={{
        background: active ? "var(--primary-dim)" : "transparent",
        color: active ? "var(--primary)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

function SortableNavRow({
  item,
  visible,
  onToggle,
}: {
  item: NavItem;
  visible: boolean;
  onToggle: () => void;
}) {
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3"
    >
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        className="btn btn-ghost btn-icon cursor-grab active:cursor-grabbing"
        aria-label={`拖曳排序 ${item.label}`}
      >
        <GripVertical size={16} aria-hidden={true} />
      </button>
      <span
        className="flex h-9 w-9 items-center justify-center rounded-md"
        style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
      >
        <NavIcon iconKey={item.iconKey} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.label}</p>
        <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {item.href}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={visible}
        onClick={onToggle}
        className="inline-flex h-6 w-11 items-center rounded-full transition-colors"
        style={{ background: visible ? "var(--primary)" : "var(--border-strong)" }}
      >
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full bg-white transition-transform"
          style={{ transform: visible ? "translateX(24px)" : "translateX(4px)" }}
        >
          {visible && <Check size={10} aria-hidden={true} style={{ color: "var(--primary)" }} />}
        </span>
      </button>
    </div>
  );
}
