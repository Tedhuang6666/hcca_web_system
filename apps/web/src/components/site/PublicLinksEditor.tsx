import { closestCenter, pointerWithin, useDroppable, type CollisionDetection } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";

import type { PublicLinkCategoryOut, PublicLinkOut } from "@/lib/types";

export function SortablePublicLinkRow({
  link,
  disabled,
  onEdit,
  onDelete,
  onToggle,
}: {
  link: PublicLinkOut;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
    disabled,
    data: { type: "link", categoryId: link.category_id ?? null },
  });
  const isManuallyEnabled = link.is_active;

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col gap-3 rounded-lg px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          className="btn btn-sm btn-ghost min-h-11 min-w-11 shrink-0 cursor-grab touch-none active:cursor-grabbing"
          aria-label={`拖曳調整「${link.title}」順序`}
          style={{ touchAction: "none" }}
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={17} aria-hidden />
        </button>
        <span className="min-w-0 pt-1 text-sm">
          <span className="font-medium">{link.title}</span>
          <span className="mt-1 block break-all text-xs text-[var(--text-muted)]">{link.url}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
            <span
              className="rounded-full px-2 py-1"
              style={{
                background: isManuallyEnabled ? "var(--success-dim)" : "var(--bg-surface)",
                color: isManuallyEnabled ? "var(--success)" : "var(--text-secondary)",
              }}
            >
              {isManuallyEnabled ? "手動啟用" : "手動停用"}
            </span>
            {link.starts_at && (
              <span>啟用：{new Date(link.starts_at).toLocaleString("zh-TW")}</span>
            )}
            {link.ends_at && (
              <span>停用：{new Date(link.ends_at).toLocaleString("zh-TW")}</span>
            )}
          </span>
        </span>
      </div>
      <div className="grid w-full grid-cols-3 gap-1 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:justify-end">
        <button type="button" className="btn btn-sm btn-ghost justify-center" onClick={onEdit} aria-label={`編輯${link.title}`}>
          <Pencil size={14} aria-hidden /> 編輯
        </button>
        <button type="button" className="btn btn-sm btn-ghost justify-center" onClick={onDelete} aria-label={`刪除${link.title}`}>
          <Trash2 size={14} aria-hidden /> 刪除
        </button>
        <button type="button" className="btn btn-sm btn-ghost justify-center" onClick={onToggle}>
          {link.is_active ? "手動停用" : "手動啟用"}
        </button>
      </div>
    </div>
  );
}

function dndItemType(args: Parameters<CollisionDetection>[0], id: string | number) {
  return args.droppableContainers.find((container) => container.id === id)?.data.current?.type;
}

export const linkTreeCollisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const allowedTypes = activeType === "category"
    ? new Set(["category"])
    : new Set(["link", "category-drop", "category"]);
  const matches = (collisions: ReturnType<typeof pointerWithin>) =>
    collisions.filter((collision) => allowedTypes.has(String(dndItemType(args, collision.id))));
  const pointerMatches = matches(pointerWithin(args));

  if (activeType === "category") {
    if (pointerMatches.length > 0) return pointerMatches;
  } else {
    const linkRow = pointerMatches.find((collision) => dndItemType(args, collision.id) === "link");
    if (linkRow) return [linkRow];
    const categoryDrop = pointerMatches.find((collision) => dndItemType(args, collision.id) === "category-drop");
    if (categoryDrop) return [categoryDrop];
    const category = pointerMatches.find((collision) => dndItemType(args, collision.id) === "category");
    if (category) return [category];
  }

  return matches(closestCenter(args));
};

export function SortablePublicLinkCategory({
  category,
  links,
  disabled,
  onDelete,
  onEditLink,
  onDeleteLink,
  onToggleLink,
}: {
  category: PublicLinkCategoryOut;
  links: PublicLinkOut[];
  disabled: boolean;
  onDelete: () => void;
  onEditLink: (link: PublicLinkOut) => void;
  onDeleteLink: (link: PublicLinkOut) => void;
  onToggleLink: (link: PublicLinkOut) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled,
    data: { type: "category", categoryId: category.id },
  });
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({
    id: `category-drop:${category.id}`,
    disabled,
    data: { type: "category-drop", categoryId: category.id },
  });

  return (
    <section
      ref={setNodeRef}
      className="rounded-xl"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <div className="rounded-xl p-3 sm:p-4" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="btn btn-sm btn-ghost min-h-11 min-w-11 shrink-0 cursor-grab touch-none active:cursor-grabbing"
            aria-label={`拖曳調整「${category.title}」分類順序`}
            style={{ touchAction: "none" }}
            disabled={disabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={17} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-semibold">{category.title}</h3>
            {category.description && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{category.description}</p>}
          </div>
          <span className="shrink-0 text-xs text-[var(--text-muted)]">{links.length} 個連結</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost min-h-11 shrink-0"
            onClick={onDelete}
            disabled={disabled}
            aria-label={`刪除「${category.title}」分類`}
          >
            <Trash2 size={14} aria-hidden />
            <span className="hidden sm:inline">刪除</span>
          </button>
        </div>
        <div
          ref={setDropNodeRef}
          className="mt-3 min-h-14 space-y-2 rounded-lg p-2 transition-colors"
          style={{
            background: isOver ? "var(--primary-dim)" : "var(--bg-surface)",
            border: `1px ${links.length ? "solid" : "dashed"} ${isOver ? "var(--primary)" : "var(--border)"}`,
          }}
        >
          {links.length === 0 ? (
            <p className="px-2 py-2 text-sm text-[var(--text-muted)]">把連結拖到這裡加入分類</p>
          ) : (
            <SortableContext items={links.map((link) => link.id)} strategy={verticalListSortingStrategy}>
              {links.map((link) => (
                <SortablePublicLinkRow
                  key={link.id}
                  link={link}
                  disabled={disabled}
                  onEdit={() => onEditLink(link)}
                  onDelete={() => onDeleteLink(link)}
                  onToggle={() => onToggleLink(link)}
                />
              ))}
            </SortableContext>
          )}
        </div>
      </div>
    </section>
  );
}

export function UnassignedPublicLinks({
  links,
  disabled,
  onEditLink,
  onDeleteLink,
  onToggleLink,
}: {
  links: PublicLinkOut[];
  disabled: boolean;
  onEditLink: (link: PublicLinkOut) => void;
  onDeleteLink: (link: PublicLinkOut) => void;
  onToggleLink: (link: PublicLinkOut) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "category-drop:uncategorized",
    disabled,
    data: { type: "category-drop", categoryId: null },
  });

  return (
    <section
      ref={setNodeRef}
      aria-label="未分類連結放置區"
      className="min-h-16 rounded-xl p-3 transition-colors sm:p-4"
      style={{
        background: isOver ? "var(--primary-dim)" : "var(--bg-surface)",
        border: `1px ${links.length ? "solid" : "dashed"} ${isOver ? "var(--primary)" : "var(--border)"}`,
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">未分類</h3>
        <span className="text-xs text-[var(--text-muted)]">{links.length} 個連結</span>
      </div>
      {links.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">把連結拖到這裡即可移出分類</p>
      ) : (
        <SortableContext items={links.map((link) => link.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {links.map((link) => (
              <SortablePublicLinkRow
                key={link.id}
                link={link}
                disabled={disabled}
                onEdit={() => onEditLink(link)}
                onDelete={() => onDeleteLink(link)}
                onToggle={() => onToggleLink(link)}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </section>
  );
}
