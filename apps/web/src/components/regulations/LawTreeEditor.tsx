"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ArticleType, RegulationArticleOut } from "@/lib/types";

export type LawNode = {
  id: string;
  type: ArticleType;
  title: string;
  content: string;
  legalNumber?: string | null;
  isCollapsed: boolean;
  children: LawNode[];
};

type FlatNode = {
  id: string;
  parent_id: string | null;
  order_index: number;
  sort_index: number;
  article_type: ArticleType;
  title: string;
  subtitle: string;
  content: string;
  legal_number?: string | null;
};

const TYPE_ORDER: ArticleType[] = [
  "volume", "chapter", "section", "article", "paragraph", "subparagraph", "item",
];

const TYPE_LABEL: Record<ArticleType, string> = {
  volume: "編",
  chapter: "章",
  section: "節",
  article: "條",
  paragraph: "項",
  subparagraph: "款",
  item: "目",
  special_clause: "附則",
  clause: "條",
  subsection: "款",
};

function typeRank(t: ArticleType): number {
  return TYPE_ORDER.indexOf(t as ArticleType);
}

function canNestInside(parentType: ArticleType, childType: ArticleType): boolean {
  const parentRank = typeRank(parentType);
  const childRank = typeRank(childType);
  return parentRank >= 0 && childRank >= 0 && childRank === parentRank + 1;
}

function childTypeOf(parentType: ArticleType): ArticleType | null {
  const rank = typeRank(parentType);
  return rank >= 0 && rank < TYPE_ORDER.length - 1 ? TYPE_ORDER[rank + 1] : null;
}

export function inferParentIdByPrevious(flat: FlatNode[], index: number, nextType: ArticleType): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const prev = flat[i];
    if (typeRank(prev.article_type) < typeRank(nextType)) return prev.id;
    if (typeRank(prev.article_type) === typeRank(nextType)) return prev.parent_id;
  }
  return null;
}

function toTree(rows: FlatNode[], collapsed: Record<string, boolean>): LawNode[] {
  const map = new Map<string, LawNode>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      type: r.article_type,
      title: r.title,
      content: r.content,
      legalNumber: r.legal_number,
      isCollapsed: collapsed[r.id] ?? false,
      children: [],
    });
  }
  const roots: LawNode[] = [];
  for (const r of rows) {
    const node = map.get(r.id)!;
    if (r.parent_id && map.has(r.parent_id)) map.get(r.parent_id)!.children.push(node);
    else roots.push(node);
  }
  const sort = (nodes: LawNode[]) => {
    nodes.sort((a, b) => {
      const ra = rows.find(x => x.id === a.id)!;
      const rb = rows.find(x => x.id === b.id)!;
      return ra.order_index - rb.order_index || ra.sort_index - rb.sort_index;
    });
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

function flatten(nodes: LawNode[], parentId: string | null = null, acc: FlatNode[] = []): FlatNode[] {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    acc.push({
      id: n.id,
      parent_id: parentId,
      order_index: i,
      sort_index: acc.length + 1,
      article_type: n.type,
      title: n.title,
      subtitle: "",
      content: n.content,
      legal_number: n.legalNumber ?? null,
    });
    flatten(n.children, n.id, acc);
  }
  return acc;
}

function computeNumbering(flat: FlatNode[]): Map<string, string> {
  const counters = { chapter: 0, section: 0, article: 0, paragraph: 0, subparagraph: 0, item: 0 };
  const map = new Map<string, string>();
  for (const a of [...flat].sort((x, y) => x.sort_index - y.sort_index)) {
    const t = a.article_type;
    const legalNumber = a.legal_number?.trim();
    if (t === "chapter") { counters.chapter += 1; counters.section = 0; map.set(a.id, `第 ${legalNumber || counters.chapter} 章`); continue; }
    if (t === "section") { counters.section += 1; map.set(a.id, `第 ${legalNumber || counters.section} 節`); continue; }
    if (t === "article" || t === "clause") { counters.article += 1; counters.paragraph = counters.subparagraph = counters.item = 0; map.set(a.id, `第 ${legalNumber || counters.article} 條`); continue; }
    if (t === "paragraph") { counters.paragraph += 1; counters.subparagraph = counters.item = 0; map.set(a.id, `第 ${legalNumber || counters.paragraph} 項`); continue; }
    if (t === "subparagraph" || t === "subsection") { counters.subparagraph += 1; counters.item = 0; map.set(a.id, `第 ${legalNumber || counters.subparagraph} 款`); continue; }
    if (t === "item") { counters.item += 1; map.set(a.id, `第 ${legalNumber || counters.item} 目`); continue; }
    map.set(a.id, "附則");
  }
  return map;
}

function moveSubtree(tree: LawNode[], movingId: string, targetId: string, mode: "before" | "after" | "inside"): LawNode[] {
  const copy = structuredClone(tree) as LawNode[];
  let moving: LawNode | null = null;
  const remove = (nodes: LawNode[]): void => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === movingId) {
        moving = nodes.splice(i, 1)[0];
        return;
      }
      remove(nodes[i].children);
      if (moving) return;
    }
  };
  remove(copy);
  if (!moving) return tree;
  const movingNode = moving;
  const insert = (nodes: LawNode[]): boolean => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === targetId) {
        if (mode === "before") nodes.splice(i, 0, movingNode);
        else if (mode === "after") nodes.splice(i + 1, 0, movingNode);
        else nodes[i].children.unshift(movingNode);
        return true;
      }
      if (insert(nodes[i].children)) return true;
    }
    return false;
  };
  insert(copy);
  return copy;
}

function moveWithinSiblings(tree: LawNode[], nodeId: string, direction: -1 | 1): LawNode[] {
  const copy = structuredClone(tree) as LawNode[];
  const move = (nodes: LawNode[]): boolean => {
    const index = nodes.findIndex(node => node.id === nodeId);
    if (index >= 0) {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= nodes.length) return true;
      [nodes[index], nodes[nextIndex]] = [nodes[nextIndex], nodes[index]];
      return true;
    }
    return nodes.some(node => move(node.children));
  };
  move(copy);
  return copy;
}

function findNode(nodes: LawNode[], id: string): LawNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}

function findParentNode(nodes: LawNode[], childId: string, parent: LawNode | null = null): LawNode | null {
  for (const node of nodes) {
    if (node.id === childId) return parent;
    const found = findParentNode(node.children, childId, node);
    if (found) return found;
  }
  return null;
}

function containsNode(node: LawNode, targetId: string): boolean {
  if (node.id === targetId) return true;
  return node.children.some(child => containsNode(child, targetId));
}

function countDescendants(node: LawNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function parseDropId(rawId: string): { targetId: string; mode: "before" | "after" | "inside" } | null {
  const match = rawId.match(/^drop-(.+)-(before|after|inside)$/);
  if (!match) return null;
  return {
    targetId: match[1],
    mode: match[2] as "before" | "after" | "inside",
  };
}

type Props = {
  articles: RegulationArticleOut[];
  onChangeFlat: (next: FlatNode[]) => Promise<void> | void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onEnterSibling?: (id: string) => void;
  onDemote?: (id: string) => void;
  statusById?: Record<string, { label: string; tone: "success" | "warning" | "danger" }>;
  onSelect?: (id: string) => void;
};

export default function LawTreeEditor({
  articles,
  onChangeFlat,
  onEdit,
  onDelete,
  onEnterSibling,
  onDemote,
  statusById = {},
  onSelect,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ targetId: string; mode: "before" | "after" | "inside"; level: number } | null>(null);
  const [outlineId, setOutlineId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<FlatNode[][]>([]);
  const [redoStack, setRedoStack] = useState<FlatNode[][]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const flat = useMemo<FlatNode[]>(
    () => [...articles].map(a => ({
      id: a.id,
      parent_id: a.parent_id ?? null,
      order_index: a.order_index ?? 0,
      sort_index: a.sort_index,
      article_type: a.article_type,
      title: a.title ?? "",
      subtitle: a.subtitle ?? "",
      content: a.content ?? "",
      legal_number: a.legal_number ?? null,
    })).sort((a, b) => a.sort_index - b.sort_index),
    [articles],
  );

  const tree = useMemo(() => toTree(flat, collapsed), [flat, collapsed]);
  const numbering = useMemo(() => computeNumbering(flat), [flat]);
  const snapshotFlat = (items: FlatNode[]) => items.map(item => ({ ...item }));

  const applyFlat = async (next: FlatNode[], options?: { skipHistory?: boolean }) => {
    const current = snapshotFlat(flat);
    const target = snapshotFlat(next);
    if (JSON.stringify(current) === JSON.stringify(target)) return;

    if (!options?.skipHistory) {
      const currentUndo = snapshotFlat(current);
      setUndoStack(prev => [...prev.slice(-19), currentUndo]);
      setRedoStack([]);
    }

    setHistoryBusy(true);
    try {
      await onChangeFlat(target);
    } finally {
      setHistoryBusy(false);
    }
  };

  const applyTree = async (nextTree: LawNode[]) => {
    const next = flatten(nextTree);
    await applyFlat(next);
  };

  const handleMoveSibling = async (nodeId: string, direction: -1 | 1) => {
    const nextTree = moveWithinSiblings(tree, nodeId, direction);
    await applyTree(nextTree);
  };

  const handleDemoteNode = async (nodeId: string) => {
    const sorted = snapshotFlat(flat).sort((a, b) => a.sort_index - b.sort_index);
    const index = sorted.findIndex(item => item.id === nodeId);
    if (index <= 0) {
      onDemote?.(nodeId);
      return;
    }
    const previous = sorted[index - 1];
    const nextType = childTypeOf(previous.article_type);
    if (!nextType) {
      onDemote?.(nodeId);
      return;
    }
    await applyFlat(sorted.map(item => (
      item.id === nodeId
        ? { ...item, parent_id: previous.id, article_type: nextType }
        : item
    )));
  };

  const handleUndo = async () => {
    if (undoStack.length === 0 || historyBusy) return;
    const previous = snapshotFlat(undoStack[undoStack.length - 1]);
    const current = snapshotFlat(flat);
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [current, ...prev].slice(0, 20));
    await applyFlat(previous, { skipHistory: true });
  };

  const handleRedo = async () => {
    if (redoStack.length === 0 || historyBusy) return;
    const next = snapshotFlat(redoStack[0]);
    const current = snapshotFlat(flat);
    setRedoStack(prev => prev.slice(1));
    setUndoStack(prev => [...prev.slice(-19), current]);
    await applyFlat(next, { skipHistory: true });
  };

  const onDragStart = (e: DragStartEvent) => {
    const rawId = String(e.active.id);
    setActiveId(rawId.replace(/^node-/, ""));
  };
  const onDragOver = (e: DragOverEvent) => {
    if (!e.over) return;
    const overId = String(e.over.id);
    if (overId.startsWith("node-")) {
      const targetId = overId.replace(/^node-/, "");
      const targetNode = findNode(tree, targetId);
      const movingNode = activeId ? findNode(tree, activeId) : null;
      if (!targetNode || !movingNode || containsNode(movingNode, targetId)) return;
      if (!canNestInside(targetNode.type, movingNode.type)) return;
      setDropHint({ targetId, mode: "inside", level: Number(e.over.data.current?.level ?? 0) + 1 });
      return;
    }
    const parsed = parseDropId(overId);
    if (!parsed) return;
    const movingNode = activeId ? findNode(tree, activeId) : null;
    if (movingNode && containsNode(movingNode, parsed.targetId) && movingNode.id !== parsed.targetId) return;
    if (movingNode) {
      const targetParent = findParentNode(tree, parsed.targetId);
      if (targetParent && !canNestInside(targetParent.type, movingNode.type)) return;
    }
    const level = Number(e.over.data.current?.level ?? 0);
    setDropHint({ targetId: parsed.targetId, mode: parsed.mode, level });
  };
  const onDragEnd = async (e: DragEndEvent) => {
    const movingId = String(e.active.id).replace("node-", "");
    if (!dropHint || !e.over) { setDropHint(null); setActiveId(null); return; }
    if (movingId !== dropHint.targetId) {
      const nextTree = moveSubtree(tree, movingId, dropHint.targetId, dropHint.mode);
      await applyTree(nextTree);
    }
    setDropHint(null);
    setActiveId(null);
  };

  const NodeRow = ({ node, level }: { node: LawNode; level: number }) => {
    const d = useDraggable({ id: `node-${node.id}` });
    const isActive = activeId === node.id;
    const movingNode = activeId ? findNode(tree, activeId) : null;
    const parentNode = findParentNode(tree, node.id);
    const canDropAsSibling = !movingNode || !parentNode || canNestInside(parentNode.type, movingNode.type);
    const canDropInside = Boolean(
      activeId
      && movingNode
      && !containsNode(movingNode, node.id)
      && canNestInside(node.type, movingNode.type),
    );
    const style: CSSProperties = {
      transform: d.transform ? `translate(${d.transform.x}px, ${d.transform.y}px)` : undefined,
      opacity: isActive ? 0.45 : 1,
    };
    const indent = Math.min(level * 12, 48);

    return (
      <div ref={d.setNodeRef} style={style} {...d.listeners} {...d.attributes}>
        <div
          id={`row-${node.id}`}
          tabIndex={0}
          onFocus={() => setOutlineId(node.id)}
          onClick={() => {
            setOutlineId(node.id);
            onSelect?.(node.id);
          }}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); onEnterSibling?.(node.id); }
            if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); void handleDemoteNode(node.id); }
          }}
          className="group relative rounded-xl px-2.5 py-3 mb-2 outline-none transition-shadow sm:px-3"
          style={{
            marginLeft: `${indent}px`,
            border: outlineId === node.id ? "1px solid var(--primary)" : "1px solid var(--border)",
            boxShadow: outlineId === node.id ? "0 0 0 2px var(--primary-dim)" : "none",
            background: isActive ? "var(--bg-elevated)" : "var(--bg-surface)",
            cursor: d.isDragging ? "grabbing" : "grab",
          }}
        >
          {activeId && activeId !== node.id && (
            <NodeDropBands
              targetId={node.id}
              level={level}
              canDropAsSibling={canDropAsSibling}
              canDropInside={canDropInside}
              activeMode={dropHint?.targetId === node.id ? dropHint.mode : null}
            />
          )}
          <div
            className="absolute top-0 bottom-0 left-0 transition-all group-hover:w-[2px]"
            style={{
              width: outlineId === node.id ? "2px" : "1px",
              marginLeft: "-12px",
              background: outlineId === node.id ? "var(--primary)" : "var(--border-strong)",
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <button
                onClick={() => setCollapsed(prev => ({ ...prev, [node.id]: !node.isCollapsed }))}
                className="w-6 h-6 shrink-0 text-xs rounded border sm:w-5 sm:h-5"
                style={{ borderColor: "var(--border)" }}
                disabled={node.children.length === 0}
              >
                {node.children.length === 0 ? "·" : node.isCollapsed ? "▸" : "▾"}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="shrink-0 text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {numbering.get(node.id) ?? TYPE_LABEL[node.type]}
                  </span>
                  <p
                    className="min-w-0 text-sm font-medium break-words"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {node.title || "（未命名）"}
                  </p>
                  {statusById[node.id] && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{
                        color:
                          statusById[node.id].tone === "success"
                            ? "var(--success)"
                            : statusById[node.id].tone === "danger"
                              ? "var(--danger)"
                              : "var(--warning)",
                        background:
                          statusById[node.id].tone === "success"
                            ? "var(--success-dim)"
                            : statusById[node.id].tone === "danger"
                              ? "rgba(220,38,38,0.1)"
                              : "rgba(245,158,11,0.1)",
                      }}
                    >
                      {statusById[node.id].label}
                    </span>
                  )}
                </div>
                {node.content && (
                  <p
                    className="text-sm whitespace-pre-wrap break-words"
                    style={{
                      color: "var(--text-secondary)",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {node.content}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 pl-8 sm:flex sm:pl-0">
              <button
                onClick={() => void handleMoveSibling(node.id, -1)}
                className="text-xs px-2 py-1.5 rounded sm:py-1"
                style={{ border: "1px solid var(--border)" }}
                title="向上移動"
              >
                ↑
              </button>
              <button
                onClick={() => void handleMoveSibling(node.id, 1)}
                className="text-xs px-2 py-1.5 rounded sm:py-1"
                style={{ border: "1px solid var(--border)" }}
                title="向下移動"
              >
                ↓
              </button>
              <button
                onClick={() => onEdit(node.id)}
                className="text-xs px-2 py-1.5 rounded sm:py-1"
                style={{ border: "1px solid var(--border)" }}
              >
                編輯
              </button>
              <button
                onClick={() => onDelete(node.id)}
                className="text-xs px-2 py-1.5 rounded sm:py-1"
                style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
              >
                刪除
              </button>
            </div>
          </div>
        </div>
        {!node.isCollapsed && node.children.map(c => <NodeRow key={c.id} node={c} level={level + 1} />)}
      </div>
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            拖曳可整塊移動子樹，`Enter` 新增同級，`Tab` 降級。
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <button
              onClick={() => void handleUndo()}
              disabled={undoStack.length === 0 || historyBusy}
              className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              上一步
            </button>
            <button
              onClick={() => void handleRedo()}
              disabled={redoStack.length === 0 || historyBusy}
              className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              下一步
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <aside className="hidden lg:col-span-1 lg:block rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
          <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>大綱導覽</p>
          <div className="space-y-1 max-h-[60vh] overflow-auto">
            {flat.map(a => (
              <button
                key={a.id}
                onClick={() => {
                  document.getElementById(`row-${a.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setOutlineId(a.id);
                }}
                className="w-full text-left text-xs px-2 py-1 rounded"
                style={{
                  marginLeft: `${(typeRank(a.article_type) + 1) * 6}px`,
                  background: outlineId === a.id ? "var(--primary-dim)" : "transparent",
                  color: outlineId === a.id ? "var(--primary)" : "var(--text-secondary)",
                }}
              >
                {(numbering.get(a.id) ?? TYPE_LABEL[a.article_type])} {a.title || "（未命名）"}
              </button>
            ))}
          </div>
        </aside>
        <section className="min-w-0 lg:col-span-3">
          {tree.map(n => <NodeRow key={n.id} node={n} level={0} />)}
        </section>
        </div>
      </div>
      <DragOverlay>
        {activeId ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs shadow-lg"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--bg-surface)",
              width: "min(22rem, 70vw)",
            }}
          >
            {(() => {
              const f = flat.find(x => x.id === activeId);
              const node = activeId ? findNode(tree, activeId) : null;
              const descendants = node ? countDescendants(node) : 0;
              return (
                <div className="space-y-1">
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {f ? (numbering.get(f.id) ?? TYPE_LABEL[f.article_type]) : ""} {f?.title ?? "（未命名）"}
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>整塊移動，包含 {descendants} 個子節點</p>
                  {node?.children.slice(0, 3).map(child => (
                    <p key={child.id} className="truncate" style={{ color: "var(--text-secondary)", paddingLeft: "0.5rem" }}>
                      └ {numbering.get(child.id) ?? TYPE_LABEL[child.type]} {child.title || "（未命名）"}
                    </p>
                  ))}
                  {node && node.children.length > 3 && (
                    <p style={{ color: "var(--text-muted)", paddingLeft: "0.5rem" }}>… 其餘 {node.children.length - 3} 個子節點</p>
                  )}
                </div>
              );
            })()}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function NodeDropBands({
  targetId,
  level,
  canDropAsSibling,
  canDropInside,
  activeMode,
}: {
  targetId: string;
  level: number;
  canDropAsSibling: boolean;
  canDropInside: boolean;
  activeMode: "before" | "after" | "inside" | null;
}) {
  const before = useDroppable({ id: `drop-${targetId}-before`, data: { mode: "before", level } });
  const inside = useDroppable({ id: `drop-${targetId}-inside`, data: { mode: "inside", level: level + 1 } });
  const after = useDroppable({ id: `drop-${targetId}-after`, data: { mode: "after", level } });

  return (
    <div className="absolute inset-0 z-10 rounded-xl overflow-hidden">
      {canDropAsSibling && (
        <div
          ref={before.setNodeRef}
          className="absolute left-0 right-0 top-0 h-[34%]"
          style={{
            borderTop: activeMode === "before" ? "2px dashed var(--primary)" : "2px dashed transparent",
            background: activeMode === "before" ? "var(--primary-dim)" : "transparent",
          }}
        />
      )}
      {activeMode === "before" && (
        <DropHintBadge text="插入於前" align="top" level={level} />
      )}
      {canDropInside && (
        <div
          ref={inside.setNodeRef}
          className="absolute left-0 right-0 top-[33%] h-[34%]"
          style={{
            border: activeMode === "inside" ? "2px dashed var(--primary)" : "2px dashed transparent",
            background: activeMode === "inside" ? "var(--primary-dim)" : "transparent",
          }}
        />
      )}
      {activeMode === "inside" && (
        <DropHintBadge text="成為子層" align="center" level={level + 1} />
      )}
      {canDropAsSibling && (
        <div
          ref={after.setNodeRef}
          className="absolute left-0 right-0 bottom-0 h-[34%]"
          style={{
            borderBottom: activeMode === "after" ? "2px dashed var(--primary)" : "2px dashed transparent",
            background: activeMode === "after" ? "var(--primary-dim)" : "transparent",
          }}
        />
      )}
      {activeMode === "after" && (
        <DropHintBadge text="插入於後" align="bottom" level={level} />
      )}
    </div>
  );
}

function DropHintBadge({
  text,
  align,
  level,
}: {
  text: string;
  align: "top" | "center" | "bottom";
  level: number;
}) {
  const positionStyle: CSSProperties =
    align === "top"
      ? { top: 4 }
      : align === "bottom"
        ? { bottom: 4 }
        : { top: "50%", transform: "translateY(-50%)" };

  return (
    <div
      className="absolute left-3 inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-sm"
      style={{
        ...positionStyle,
        color: "var(--primary)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <span>↳</span>
      <span>{text}</span>
      <span style={{ color: "var(--text-muted)" }}>層級 {level + 1}</span>
    </div>
  );
}
