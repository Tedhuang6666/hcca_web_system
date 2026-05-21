"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { ArticleType, RegulationArticleOut } from "@/lib/types";
import { toast } from "sonner";

import {
  ARTICLE_IS_STRUCTURAL,
  ARTICLE_TYPE_LABEL,
  ARTICLE_TYPE_META,
  canNestInside,
  childTypeOf,
  normalizeArticleType,
  buildArticleDisplayRows,
} from "@/lib/regulationStructure";
import {
  buildArticleTree,
  findContainerOf,
  flattenArticleTree,
  flattenTreeForOutline,
  inferParentIdByPrevious as inferParentIdByPreviousFn,
  type ArticleTreeNode,
  type FlatArticleNode,
} from "@/lib/articleTree";

// 對外維持原 API：inferParentIdByPrevious 從 articleTree.ts re-export
export { inferParentIdByPreviousFn as inferParentIdByPrevious };

// 對外維持原 API：LawNode 型別供 RegulationEditParts 使用
export type LawNode = {
  id: string;
  type: ArticleType;
  title: string;
  content: string;
  legalNumber?: string | null;
  isCollapsed: boolean;
  children: LawNode[];
};

type Status = { label: string; tone: "success" | "warning" | "danger" };

interface SortableRowItem {
  node: ArticleTreeNode;
  /** 因章節摺疊而隱藏。 */
  hidden: boolean;
  /** 章節摺疊狀態（傳給 LawArticleRow）。 */
  chapterCollapsed: boolean;
  badge: string;
}

interface Props {
  articles: RegulationArticleOut[];
  onChangeFlat: (next: FlatArticleNode[]) => Promise<void> | void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onEnterSibling?: (id: string) => void;
  onDemote?: (id: string) => void;
  onPromote?: (id: string) => void;
  statusById?: Record<string, Status>;
  onSelect?: (id: string) => void;
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

export default function LawTreeEditor({
  articles,
  onChangeFlat,
  onEdit,
  onDelete,
  onEnterSibling,
  onDemote,
  onPromote,
  statusById = {},
  onSelect,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justMoved, setJustMoved] = useState<string | null>(null);

  // 1) 將 articles 建為 tree → flatten → 顯示用 list。
  //    過濾 is_deleted；任一祖先被收合 → 該節點 hidden（不限章，任何層級皆可收合）。
  const sortableItems: SortableRowItem[] = useMemo(() => {
    const visible = articles.filter((a) => !a.is_deleted);
    const tree = buildArticleTree(visible);
    const flat = flattenTreeForOutline(tree);
    // 編號必須依「實際渲染順序」(flat：樹狀展開 + 已排序) 計算，
    // 不能用未排序的 visible，否則拖曳後會出現第2章在第1章上方的錯位。
    const rows = buildArticleDisplayRows(flat, {});
    const badgeMap = new Map(rows.map((r) => [r.article.id, r.displayLabel]));
    const nodeById = new Map(flat.map((n) => [n.id, n]));
    const isHidden = (node: ArticleTreeNode): boolean => {
      let pid = node.parent_id;
      while (pid) {
        if (collapsed[pid]) return true;
        pid = nodeById.get(pid)?.parent_id ?? null;
      }
      return false;
    };
    return flat.map((node) => ({
      node,
      hidden: isHidden(node),
      chapterCollapsed: collapsed[node.id] ?? false,
      badge: badgeMap.get(node.id) ?? ARTICLE_TYPE_LABEL[node.article_type] ?? node.article_type,
    }));
  }, [articles, collapsed]);

  const visibleItems = sortableItems.filter((item) => !item.hidden);
  const visibleIds = visibleItems.map((item) => item.node.id);

  // 2) Sensors：滑鼠（8px 觸發）+ 觸控（200ms delay 避免 scroll 衝突）+ 鍵盤
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 3) 套用變動到後端：接收 flat list（已含 parent_id/order_index/sort_index）
  const applyFlat = useCallback(
    async (next: FlatArticleNode[]) => {
      setBusy(true);
      try {
        await onChangeFlat(next);
      } finally {
        setBusy(false);
      }
    },
    [onChangeFlat],
  );

  // 透過 mutator 操作 tree（structuredClone 避免破壞原 articles），再 flatten 後送出。
  const operateTree = useCallback(
    async (mutator: (tree: ArticleTreeNode[]) => boolean | void) => {
      const editable = articles.filter((a) => !a.is_deleted);
      const tree = buildArticleTree(editable);
      const ok = mutator(tree);
      if (ok === false) return;
      const flat = flattenArticleTree(tree);
      // 補上原始 article 的 title/content/subtitle/legal_number（flatten 已帶但保險）
      const articleMap = new Map(articles.map((a) => [a.id, a]));
      const enriched: FlatArticleNode[] = flat.map((node) => {
        const src = articleMap.get(node.id);
        return {
          ...node,
          title: node.title || src?.title || "",
          subtitle: node.subtitle || src?.subtitle || "",
          content: node.content || src?.content || "",
          legal_number: node.legal_number ?? src?.legal_number ?? null,
        };
      });
      await applyFlat(enriched);
    },
    [articles, applyFlat],
  );

  // 4) 同層上下移動（按鈕 / 鍵盤）
  const moveSibling = useCallback(
    async (id: string, direction: -1 | 1) => {
      setJustMoved(id);
      window.setTimeout(() => setJustMoved(null), 800);
      await operateTree((tree) => {
        const found = findContainerOf(tree, id);
        if (!found) return false;
        const { container, idx } = found;
        const nextIdx = idx + direction;
        if (nextIdx < 0 || nextIdx >= container.length) return false;
        [container[idx], container[nextIdx]] = [container[nextIdx], container[idx]];
      });
    },
    [operateTree],
  );

  // 5) 降級：將 target 變成前一兄弟之子，若型別不合法則自動降型。
  //    防呆：若前一兄弟不允許任何子層（如 item / special_clause），拒絕降級。
  const demote = useCallback(
    async (id: string) => {
      let blocked = false;
      let blockMsg = "";
      setJustMoved(id);
      window.setTimeout(() => setJustMoved(null), 800);
      await operateTree((tree) => {
        const found = findContainerOf(tree, id);
        if (!found) return false;
        const { container, idx } = found;
        if (idx === 0) {
          blocked = true;
          blockMsg = "此節點為同層第一個，請先在它前面加入可作為父層的條目";
          return false;
        }
        const target = container[idx];
        const prev = container[idx - 1];
        let newType: ArticleType = target.article_type;
        if (!canNestInside(prev.article_type, target.article_type)) {
          const ct = childTypeOf(prev.article_type);
          if (!ct) {
            blocked = true;
            blockMsg = `${ARTICLE_TYPE_LABEL[prev.article_type] ?? prev.article_type} 不允許再加子層`;
            return false;
          }
          newType = ct as ArticleType;
        }
        // 移除 target 並接到 prev.children 末尾
        container.splice(idx, 1);
        target.article_type = newType;
        target.parent_id = prev.id;
        target.depth = prev.depth + 1;
        prev.children.push(target);
      });
      if (blocked) {
        toast.error(blockMsg);
        onDemote?.(id);
      }
    },
    [operateTree, onDemote],
  );

  // 6) 升級：將 target 移到父的兄弟位置（grandParent 之下、parent 之後）。
  //    保持 type 優先；若 grandParent 不允許 target.type，自動升型為 parent.type。
  //    若 root 也不允許（如「項」想升到 root），拒絕並提示。
  const promote = useCallback(
    async (id: string) => {
      let blocked = false;
      let blockMsg = "";
      setJustMoved(id);
      window.setTimeout(() => setJustMoved(null), 800);
      await operateTree((tree) => {
        const found = findContainerOf(tree, id);
        if (!found || !found.parent) {
          blocked = true;
          blockMsg = "此節點已位於最頂層，無法再升級";
          return false;
        }
        const { container, idx, parent } = found;
        const target = container[idx];

        const grandFound = findContainerOf(tree, parent.id);
        const grandContainer = grandFound ? grandFound.container : tree;
        const grandParent = grandFound ? grandFound.parent : null;
        const grandParentType = grandParent?.article_type ?? null;

        // 決定升級後的 type：
        //   1. 若 grandParent 允許 target.type → 保持
        //   2. 否則改為 parent.type（升一級）— 需 grandParent 也允許
        let newType: ArticleType = target.article_type;
        if (!canNestInside(grandParentType, target.article_type)) {
          if (canNestInside(grandParentType, parent.article_type)) {
            newType = parent.article_type;
          } else {
            blocked = true;
            blockMsg = `無法升級：${ARTICLE_TYPE_LABEL[target.article_type] ?? target.article_type} 在 ${grandParentType ? ARTICLE_TYPE_LABEL[grandParentType] : "頂層"} 下不合法`;
            return false;
          }
        }

        // 從原位置移除
        container.splice(idx, 1);
        target.article_type = newType;
        target.parent_id = grandParent?.id ?? null;
        target.depth = grandParent ? grandParent.depth + 1 : 0;

        // 插入 grandContainer，位於 parent 之後（成為 parent 的下一個兄弟）
        const parentIdx = grandContainer.findIndex((c) => c.id === parent.id);
        grandContainer.splice(parentIdx + 1, 0, target);
      });
      if (blocked) {
        toast.error(blockMsg);
        onPromote?.(id);
      }
    },
    [operateTree, onPromote],
  );

  // 6) 拖拉事件
  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const activeIdStr = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeIdStr === overId) return;

    const delta = event.delta?.x ?? 0;
    const shouldNest = delta > 40;

    // 用可見順序判斷拖拉方向：往下（true）插在 over 之後，往上插在 over 之前。
    const oldIndex = visibleIds.indexOf(activeIdStr);
    const newIndex = visibleIds.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const movingDown = oldIndex < newIndex;

    setJustMoved(activeIdStr);
    window.setTimeout(() => setJustMoved(null), 800);

    let blockMsg = "";
    await operateTree((tree) => {
      const activeFound = findContainerOf(tree, activeIdStr);
      const overFound = findContainerOf(tree, overId);
      if (!activeFound || !overFound) return false;

      const activeNode = activeFound.container[activeFound.idx];
      const overNode = overFound.container[overFound.idx];

      // 防呆：不允許把 active 拖到自己子樹中
      const isOverInActive = (() => {
        let cur: ArticleTreeNode | null = overNode;
        while (cur) {
          if (cur.id === activeNode.id) return true;
          if (!cur.parent_id) return false;
          const next = findContainerOf(tree, cur.parent_id);
          cur = next?.container[next.idx] ?? null;
        }
        return false;
      })();
      if (isOverInActive) {
        blockMsg = "不可將節點拖到自己的子樹中";
        return false;
      }

      // 放置策略：shouldNest 且合法 → 成為 over 的子層；否則 → over 的兄弟。
      const nestOk = shouldNest && canNestInside(overNode.article_type, activeNode.article_type);
      const overParent = overFound.parent;
      const overParentType = overParent?.article_type ?? null;
      const siblingAllowed = canNestInside(overParentType, activeNode.article_type);

      if (!nestOk && !siblingAllowed) {
        blockMsg = `${ARTICLE_TYPE_LABEL[activeNode.article_type]} 不能放在 ${overParentType ? ARTICLE_TYPE_LABEL[overParentType] : "頂層"} 之下`;
        return false;
      }

      // 移除 active，再重新定位 over（idx 在移除後可能改變）
      activeFound.container.splice(activeFound.idx, 1);
      const overFound2 = findContainerOf(tree, overId);
      if (!overFound2) {
        blockMsg = "拖拉失敗：找不到目標";
        return false;
      }

      if (nestOk) {
        const overNode2 = overFound2.container[overFound2.idx];
        activeNode.parent_id = overNode2.id;
        activeNode.depth = overNode2.depth + 1;
        overNode2.children.push(activeNode);
      } else {
        // 同層 reorder：往下拖插在 over 之後、往上拖插在 over 之前
        activeNode.parent_id = overFound2.parent?.id ?? null;
        activeNode.depth = overFound2.parent ? overFound2.parent.depth + 1 : 0;
        const insertIdx = movingDown ? overFound2.idx + 1 : overFound2.idx;
        overFound2.container.splice(insertIdx, 0, activeNode);
      }
    });
    if (blockMsg) toast.error(blockMsg);
  };

  // 7) 鍵盤快捷
  const handleRowKeyDown = (id: string, event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onEdit(id);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      // toggle collapse if applicable
      event.preventDefault();
      setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
      return;
    }
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      void moveSibling(id, 1);
      return;
    }
    if (event.key === "ArrowUp" && event.altKey) {
      event.preventDefault();
      void moveSibling(id, -1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) void promote(id);
      else void demote(id);
    }
  };

  const onDragMove = () => {
    // 預留：將來可在 DragOverlay 顯示 nesting hint
  };

  if (visibleItems.length === 0) {
    return (
      <div className="law-tree-empty">
        尚無條文。使用上方「新增條文」開始建立法規結構。
      </div>
    );
  }

  // 計算每個節點是否有「可見的」子節點（用於 caret 顯示）
  const childCountMap = new Map<string, number>();
  for (const item of sortableItems) {
    const pid = item.node.parent_id;
    if (pid) childCountMap.set(pid, (childCountMap.get(pid) ?? 0) + 1);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      <div className="law-tree">
        <div className="law-tree-hint">
          <span><kbd className="kbd-hint">⠿</kbd> 拖拉排序</span>
          <span><kbd className="kbd-hint">Alt</kbd>+<kbd className="kbd-hint">↑↓</kbd> 同層移動</span>
          <span><kbd className="kbd-hint">Tab</kbd> 降級 · <kbd className="kbd-hint">⇧Tab</kbd> 升級</span>
          <span><kbd className="kbd-hint">Enter</kbd> 編輯</span>
        </div>
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          <div className="law-tree-body" role="tree">
            {visibleItems.map((item) => (
              <SortableLawRow
                key={item.node.id}
                item={item}
                isDraggingThis={activeId === item.node.id}
                justMoved={justMoved === item.node.id}
                status={statusById[item.node.id]}
                busy={busy}
                hasChildren={(childCountMap.get(item.node.id) ?? 0) > 0}
                onEdit={onEdit}
                onDelete={onDelete}
                onEnterSibling={onEnterSibling}
                onPromote={() => void promote(item.node.id)}
                onDemote={() => void demote(item.node.id)}
                onMoveUp={() => void moveSibling(item.node.id, -1)}
                onMoveDown={() => void moveSibling(item.node.id, 1)}
                onToggleCollapse={() =>
                  setCollapsed((prev) => ({ ...prev, [item.node.id]: !prev[item.node.id] }))
                }
                onKeyDown={(event) => handleRowKeyDown(item.node.id, event)}
                onSelect={() => onSelect?.(item.node.id)}
              />
            ))}
          </div>
        </SortableContext>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeId
          ? (() => {
              const item = sortableItems.find((s) => s.node.id === activeId);
              if (!item) return null;
              const meta = ARTICLE_TYPE_META[normalizeArticleType(item.node.article_type)];
              return (
                <div className="law-tree-ghost">
                  <span
                    className="law-badge"
                    style={{ background: meta.badgeBg, color: meta.badgeColor, borderColor: meta.borderColor }}
                  >
                    {item.badge}
                  </span>
                  <span className="law-ghost-title">{item.node.title || "（未命名）"}</span>
                </div>
              );
            })()
          : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── 圖示 ──────────────────────────────────────────────────────────────────────

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 140ms ease" }}
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" />
    <circle cx="15" cy="6" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);

// ── 單一樹狀行 ────────────────────────────────────────────────────────────────

interface SortableLawRowProps {
  item: SortableRowItem;
  isDraggingThis: boolean;
  justMoved: boolean;
  status?: Status;
  busy: boolean;
  hasChildren: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onEnterSibling?: (id: string) => void;
  onPromote: () => void;
  onDemote: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleCollapse: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSelect: () => void;
}

function SortableLawRow({
  item,
  isDraggingThis,
  justMoved,
  status,
  busy,
  hasChildren,
  onEdit,
  onDelete,
  onEnterSibling,
  onPromote,
  onDemote,
  onMoveUp,
  onMoveDown,
  onToggleCollapse,
  onKeyDown,
  onSelect,
}: SortableLawRowProps) {
  const { node, badge, chapterCollapsed } = item;
  const sortable = useSortable({ id: node.id });
  const normalized = normalizeArticleType(node.article_type);
  const meta = ARTICLE_TYPE_META[normalized];
  const isStructural = ARTICLE_IS_STRUCTURAL[normalized] ?? false;
  const canPromote = Boolean(node.parent_id);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: isDraggingThis ? 0.4 : 1,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      data-just-moved={justMoved ? "true" : undefined}
      className="law-tree-item"
    >
      <div
        className={`law-tree-row${isStructural ? " is-structural" : ""}`}
        data-type={normalized}
        role="treeitem"
        aria-selected={false}
        aria-grabbed={sortable.isDragging}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={onSelect}
        style={{ borderLeft: `${meta.borderWidth}px solid ${meta.borderColor}` }}
      >
        {/* 階層連接線 */}
        {Array.from({ length: node.depth }).map((_, i) => (
          <span key={i} className="law-guide" aria-hidden="true" />
        ))}

        {/* 展開 / 收合 caret */}
        <button
          type="button"
          className="law-caret"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse();
          }}
          aria-label={chapterCollapsed ? "展開" : "收合"}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          <ChevronIcon open={!chapterCollapsed} />
        </button>

        {/* 層級徽章 */}
        <span
          className="law-badge"
          style={{ background: meta.badgeBg, color: meta.badgeColor, borderColor: meta.borderColor }}
        >
          {badge}
        </span>

        {/* 標題 + 內容預覽 */}
        <span className="law-label">
          {node.title
            ? <span className="law-title">{node.title}</span>
            : (!node.content && <span className="law-empty-text">（未命名）</span>)}
          {node.content && <span className="law-preview">{node.content}</span>}
        </span>

        {/* 異動狀態 */}
        {status && (
          <span className={`law-status tone-${status.tone}`}>{status.label}</span>
        )}

        {/* 操作區（hover 顯示，手機常駐） */}
        <div className="law-actions">
          <button
            type="button"
            ref={sortable.setActivatorNodeRef}
            {...sortable.listeners}
            {...sortable.attributes}
            className="law-handle"
            tabIndex={-1}
            aria-label="拖拉以重新排序"
            title="拖拉以重新排序"
          >
            <GripIcon />
          </button>
          <button
            type="button"
            className="law-act"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(node.id);
            }}
            aria-label="編輯條文"
            title="編輯"
          >
            <EditIcon />
          </button>
          <RowMenu
            busy={busy}
            canPromote={canPromote}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onPromote={onPromote}
            onDemote={onDemote}
            onAddSibling={onEnterSibling ? () => onEnterSibling(node.id) : undefined}
            onDelete={() => onDelete(node.id)}
          />
        </div>
      </div>
    </div>
  );
}

// ── 更多操作選單（⋯） ─────────────────────────────────────────────────────────

interface RowMenuProps {
  busy: boolean;
  canPromote: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPromote: () => void;
  onDemote: () => void;
  onAddSibling?: () => void;
  onDelete: () => void;
}

function RowMenu({
  busy,
  canPromote,
  onMoveUp,
  onMoveDown,
  onPromote,
  onDemote,
  onAddSibling,
  onDelete,
}: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const run = (fn: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    setOpen(false);
    fn();
  };

  return (
    <div className="law-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="law-act"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多操作"
        title="更多操作"
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="law-menu" role="menu">
          <button type="button" className="law-menu-item" disabled={busy} onClick={run(onMoveUp)}>
            <span className="law-menu-ic">↑</span> 上移
          </button>
          <button type="button" className="law-menu-item" disabled={busy} onClick={run(onMoveDown)}>
            <span className="law-menu-ic">↓</span> 下移
          </button>
          <div className="law-menu-sep" />
          <button
            type="button"
            className="law-menu-item"
            disabled={busy || !canPromote}
            onClick={run(onPromote)}
          >
            <span className="law-menu-ic">⬅</span> 升級（移出本層）
          </button>
          <button type="button" className="law-menu-item" disabled={busy} onClick={run(onDemote)}>
            <span className="law-menu-ic">➡</span> 降級（縮排為子層）
          </button>
          {onAddSibling && (
            <>
              <div className="law-menu-sep" />
              <button type="button" className="law-menu-item" onClick={run(onAddSibling)}>
                <span className="law-menu-ic">＋</span> 新增同級條文
              </button>
            </>
          )}
          <div className="law-menu-sep" />
          <button
            type="button"
            className="law-menu-item is-danger"
            onClick={run(onDelete)}
          >
            <span className="law-menu-ic">✕</span> 刪除
          </button>
        </div>
      )}
    </div>
  );
}

