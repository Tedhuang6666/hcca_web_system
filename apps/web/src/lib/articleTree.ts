/**
 * 條文樹狀結構轉換工具（純函數）。
 * 統一從 `RegulationEditParts.buildLawTree/flattenTree` 與 `LawTreeEditor.toTree/flatten` 抽出。
 */

import type { RegulationArticleOut, ArticleType } from "@/lib/types";
import { typeRank as articleTypeRank } from "@/lib/regulationStructure";

/** 樹節點（含 children），可承載任意延伸欄位。 */
export interface ArticleTreeNode {
  id: string;
  parent_id: string | null;
  order_index: number;
  sort_index: number;
  article_type: ArticleType;
  title: string;
  subtitle: string;
  content: string;
  legal_number: string | null;
  is_deleted: boolean;
  frozen_by: string | null;
  children: ArticleTreeNode[];
  /** 原始 article 物件保留供回頭查找。 */
  article: RegulationArticleOut;
  /** 樹深度（root = 0），由 buildArticleTree 計算填入。 */
  depth: number;
}

/** Flat 表示，給編輯器 / API 用。 */
export interface FlatArticleNode {
  id: string;
  parent_id: string | null;
  order_index: number;
  sort_index: number;
  article_type: ArticleType;
  title: string;
  subtitle: string;
  content: string;
  legal_number: string | null;
}

function toFlatBase(a: RegulationArticleOut): FlatArticleNode {
  return {
    id: a.id,
    parent_id: a.parent_id ?? null,
    order_index: a.order_index ?? 0,
    sort_index: a.sort_index,
    article_type: a.article_type,
    title: a.title ?? "",
    subtitle: a.subtitle ?? "",
    content: a.content ?? "",
    legal_number: a.legal_number ?? null,
  };
}

/** 將 flat 條文陣列建為樹狀（按 order_index → sort_index 排序）。 */
export function buildArticleTree(articles: RegulationArticleOut[]): ArticleTreeNode[] {
  const map = new Map<string, ArticleTreeNode>();
  for (const a of articles) {
    map.set(a.id, {
      id: a.id,
      parent_id: a.parent_id ?? null,
      order_index: a.order_index ?? 0,
      sort_index: a.sort_index,
      article_type: a.article_type,
      title: a.title ?? "",
      subtitle: a.subtitle ?? "",
      content: a.content ?? "",
      legal_number: a.legal_number ?? null,
      is_deleted: a.is_deleted,
      frozen_by: a.frozen_by ?? null,
      children: [],
      article: a,
      depth: 0,
    });
  }
  const roots: ArticleTreeNode[] = [];
  for (const a of articles) {
    const node = map.get(a.id);
    if (!node) continue;
    const parentId = a.parent_id ?? null;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortAndAssignDepth = (nodes: ArticleTreeNode[], depth: number) => {
    nodes.sort((a, b) => a.order_index - b.order_index || a.sort_index - b.sort_index);
    for (const n of nodes) {
      n.depth = depth;
      sortAndAssignDepth(n.children, depth + 1);
    }
  };
  sortAndAssignDepth(roots, 0);
  return roots;
}

/**
 * 將樹回 flat（前序走訪），重新計算 order_index（同層 0-based）與 sort_index（全域連號）。
 * 用於把編輯後的樹推回 API。
 */
export function flattenArticleTree(
  nodes: ArticleTreeNode[],
  parentId: string | null = null,
  acc: FlatArticleNode[] = [],
): FlatArticleNode[] {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    acc.push({
      id: n.id,
      parent_id: parentId,
      order_index: i,
      sort_index: acc.length + 1,
      article_type: n.article_type,
      title: n.title,
      subtitle: n.subtitle,
      content: n.content,
      legal_number: n.legal_number,
    });
    flattenArticleTree(n.children, n.id, acc);
  }
  return acc;
}

/** 將條文陣列轉為 flat（保留原順序，僅做基本轉型）。 */
export function articlesToFlat(articles: RegulationArticleOut[]): FlatArticleNode[] {
  return [...articles]
    .sort((a, b) => a.sort_index - b.sort_index)
    .map(toFlatBase);
}

/** 在樹中尋找節點，找不到回傳 null。 */
export function findArticleNode(
  nodes: ArticleTreeNode[],
  id: string,
): ArticleTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findArticleNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** 在樹中尋找指定節點的父節點，root 回傳 null。 */
export function findArticleParent(
  nodes: ArticleTreeNode[],
  childId: string,
  parent: ArticleTreeNode | null = null,
): ArticleTreeNode | null {
  for (const node of nodes) {
    if (node.id === childId) return parent;
    const found = findArticleParent(node.children, childId, node);
    if (found) return found;
  }
  return null;
}

/** 判斷 target 是否在 node 的子樹內（含自身）。 */
export function containsArticleNode(node: ArticleTreeNode, targetId: string): boolean {
  if (node.id === targetId) return true;
  return node.children.some(child => containsArticleNode(child, targetId));
}

/** 計算節點下方所有後代數量（不含自身）。 */
export function countArticleDescendants(node: ArticleTreeNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countArticleDescendants(child), 0);
}

/** 將整棵樹回傳為一維陣列（前序），用於大綱導覽 / 顯示計算。 */
export function flattenTreeForOutline(nodes: ArticleTreeNode[]): ArticleTreeNode[] {
  const acc: ArticleTreeNode[] = [];
  const walk = (list: ArticleTreeNode[]) => {
    for (const n of list) {
      acc.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return acc;
}

/**
 * 在 flat 陣列中根據前一節點推斷新節點的 parent_id。
 * 從 index-1 向上掃描，找到第一個層級嚴格較淺者作為父；同級者用其父。
 */
export function inferParentIdByPrevious(
  flat: FlatArticleNode[],
  index: number,
  nextType: ArticleType,
): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const prev = flat[i];
    if (articleTypeRank(prev.article_type) < articleTypeRank(nextType)) return prev.id;
    if (articleTypeRank(prev.article_type) === articleTypeRank(nextType)) return prev.parent_id;
  }
  return null;
}

/**
 * 取得 anchor 子樹結束後的插入位置（用於「在後面新增」）。
 * 例如 anchor 是「第二章」，回傳「第二章」連同其下所有節（節、條…）之後的索引。
 */
export function getSubtreeEndIndex<T extends { id: string; parent_id: string | null; sort_index: number }>(
  items: T[],
  anchorId: string,
): number {
  const sorted = items.slice().sort((a, b) => a.sort_index - b.sort_index);
  const start = sorted.findIndex(item => item.id === anchorId);
  if (start < 0) return sorted.length;
  const subtreeIds = new Set<string>([anchorId]);
  let end = start;
  for (let i = start + 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current.parent_id && subtreeIds.has(current.parent_id)) {
      subtreeIds.add(current.id);
      end = i;
      continue;
    }
    break;
  }
  return end + 1;
}

// ── 拖拉與層級操作 ────────────────────────────────────────────────────────────

/**
 * 將節點移動到目標旁邊/內部，回傳新樹（不修改原 tree）。
 * mode: "before" / "after" 為同層級兄弟位移；"inside" 為成為子層第一個。
 */
export function moveArticleSubtree(
  tree: ArticleTreeNode[],
  movingId: string,
  targetId: string,
  mode: "before" | "after" | "inside",
): ArticleTreeNode[] {
  const copy = structuredClone(tree) as ArticleTreeNode[];
  let moving: ArticleTreeNode | null = null;
  const remove = (nodes: ArticleTreeNode[]): void => {
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
  const movingNode = moving as ArticleTreeNode;
  const insert = (nodes: ArticleTreeNode[]): boolean => {
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

/** 在同層兄弟之間上下移動，回傳新樹。 */
export function moveArticleWithinSiblings(
  tree: ArticleTreeNode[],
  nodeId: string,
  direction: -1 | 1,
): ArticleTreeNode[] {
  const copy = structuredClone(tree) as ArticleTreeNode[];
  const move = (nodes: ArticleTreeNode[]): boolean => {
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
