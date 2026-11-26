"use client";

import type { ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

type SortableItemProps<T extends { id: string }> = {
  item: T;
  label: string;
  disabled: boolean;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
};

function SortableItem<T extends { id: string }>({
  item,
  label,
  disabled,
  renderItem,
}: SortableItemProps<T>) {
  const sortable = useSortable({ id: item.id, disabled });
  return (
    <div
      ref={sortable.setNodeRef}
      className="relative"
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        zIndex: sortable.isDragging ? 1 : undefined,
        opacity: sortable.isDragging ? 0.65 : undefined,
      }}
    >
      {renderItem(
        item,
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          disabled={disabled}
          className="btn btn-ghost min-h-11 min-w-11 shrink-0 touch-none px-2 text-fg-muted!"
          aria-label={`拖曳以調整${label}順序`}
          title={`調整${label}順序`}
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>,
      )}
    </div>
  );
}

export default function ShopAdminSortableList<T extends { id: string }>({
  items,
  label,
  disabled = false,
  onReorder,
  renderItem,
}: {
  items: T[];
  label: string;
  disabled?: boolean;
  onReorder: (items: T[]) => void;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || disabled) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={reorder}
      accessibility={{
        screenReaderInstructions: {
          draggable: "按空白鍵或 Enter 拿起，使用方向鍵移動，再按空白鍵或 Enter 放下，按 Escape 取消。",
        },
      }}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              label={label}
              disabled={disabled || items.length < 2}
              renderItem={renderItem}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
