"use client";

import { useState } from "react";
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
  rectSwappingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, Plus, X } from "lucide-react";
import { MOBILE_NAV_MIN_ITEMS, type NavItem } from "@/lib/navigation";
import NavIcon from "./NavIcon";

interface MobileNavConfiguratorProps {
  items: NavItem[];
  selectedIds: string[];
  onChange: (slotIds: string[]) => void;
}

export default function MobileNavConfigurator({
  items,
  selectedIds,
  onChange,
}: MobileNavConfiguratorProps) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const itemById = new Map(items.map((item) => [item.id, item]));
  const slotItems = selectedIds
    .map((id) => itemById.get(id))
    .filter((item, index, selected): item is NavItem => Boolean(item) && selected.indexOf(item) === index);

  const selectItem = (itemId: string) => {
    if (selectedSlot === null) return;
    const nextSlots = Array.from(
      { length: MOBILE_NAV_MIN_ITEMS },
      (_, index) => slotItems[index]?.id ?? "",
    );
    const existingIndex = nextSlots.indexOf(itemId);
    if (existingIndex >= 0 && existingIndex !== selectedSlot) {
      [nextSlots[selectedSlot], nextSlots[existingIndex]] = [
        nextSlots[existingIndex],
        nextSlots[selectedSlot],
      ];
    } else {
      nextSlots[selectedSlot] = itemId;
    }
    onChange(nextSlots.filter(Boolean));
    setSelectedSlot(null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const currentSlots = slotItems.map((item) => item.id);
    const oldIndex = currentSlots.indexOf(String(active.id));
    const newIndex = currentSlots.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(currentSlots, oldIndex, newIndex));
  };

  return (
    <div className="@container">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={slotItems.map((item) => item.id)}
          strategy={rectSwappingStrategy}
        >
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
            {Array.from({ length: MOBILE_NAV_MIN_ITEMS }, (_, slotIndex) => {
              const item = slotItems[slotIndex];
              if (!item) {
                return (
                  <EmptyMobileNavSlot
                    key={`empty-${slotIndex}`}
                    slotIndex={slotIndex}
                    onClick={() => setSelectedSlot(slotIndex)}
                  />
                );
              }
              return (
                <MobileNavSlot
                  key={item.id}
                  item={item}
                  slotIndex={slotIndex}
                  selected={selectedSlot === slotIndex}
                  onClick={() => setSelectedSlot(slotIndex)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {selectedSlot !== null && (
        <MobileNavPicker
          items={items}
          selectedIds={slotItems.map((item) => item.id)}
          slotIndex={selectedSlot}
          onChoose={selectItem}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  );
}

function MobileNavSlot({
  item,
  slotIndex,
  selected,
  onClick,
}: {
  item: NavItem;
  slotIndex: number;
  selected: boolean;
  onClick: () => void;
}) {
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <button
      ref={sortable.setNodeRef}
      type="button"
      {...sortable.attributes}
      {...sortable.listeners}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`第 ${slotIndex + 1} 格：${item.label}，點擊設定功能或拖曳排序`}
      className="relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-colors"
      style={{
        ...style,
        borderColor: selected ? "var(--primary)" : "var(--border)",
        background: selected ? "var(--primary-dim)" : "var(--bg-muted)",
        color: "var(--text)",
        cursor: sortable.isDragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
    >
      <span
        className="absolute left-2 top-2 text-[10px] font-semibold"
        style={{ color: selected ? "var(--primary)" : "var(--text-muted)" }}
      >
        {String(slotIndex + 1).padStart(2, "0")}
      </span>
      <span
        className="flex h-11 w-11 items-center justify-center rounded-lg"
        style={{ background: "var(--bg-elevated)", color: selected ? "var(--primary)" : "var(--text-muted)" }}
      >
        <NavIcon iconKey={item.iconKey} size={22} />
      </span>
      <span className="line-clamp-2 text-sm font-semibold leading-tight">{item.label}</span>
      <GripVertical
        size={14}
        aria-hidden={true}
        className="absolute bottom-2 right-2"
        style={{ color: "var(--text-muted)" }}
      />
    </button>
  );
}

function EmptyMobileNavSlot({ slotIndex, onClick }: { slotIndex: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`設定第 ${slotIndex + 1} 格功能`}
      className="relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center transition-colors"
      style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
    >
      <span className="absolute left-2 top-2 text-[10px] font-semibold">
        {String(slotIndex + 1).padStart(2, "0")}
      </span>
      <Plus size={22} aria-hidden={true} />
      <span className="text-xs">點擊設定入口</span>
    </button>
  );
}

function MobileNavPicker({
  items,
  selectedIds,
  slotIndex,
  onChoose,
  onClose,
}: {
  items: NavItem[];
  selectedIds: string[];
  slotIndex: number;
  onChoose: (itemId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="mt-4 rounded-xl border p-4"
      style={{ borderColor: "var(--primary)", background: "var(--bg-muted)" }}
      aria-label={`設定第 ${slotIndex + 1} 格功能`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">設定第 {slotIndex + 1} 格</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            選擇入口後會立即套用；已使用的入口會與目前格子交換。
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="關閉功能選擇">
          <X size={16} aria-hidden={true} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const selectedIndex = selectedIds.indexOf(item.id);
          const isCurrent = selectedIndex === slotIndex;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChoose(item.id)}
              aria-pressed={isCurrent}
              className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: isCurrent ? "var(--primary)" : "var(--border)",
                background: isCurrent ? "var(--primary-dim)" : "var(--bg-elevated)",
                color: "var(--text)",
              }}
            >
              <span style={{ color: isCurrent ? "var(--primary)" : "var(--text-muted)" }}>
                <NavIcon iconKey={item.iconKey} size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
              {isCurrent ? (
                <Check size={16} aria-label="目前選取" style={{ color: "var(--primary)" }} />
              ) : selectedIndex >= 0 ? (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  第 {selectedIndex + 1} 格
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
