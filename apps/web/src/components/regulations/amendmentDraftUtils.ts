import type { ArticleType, RegulationArticleOut } from "@/lib/types";

// ── 型別定義 ──────────────────────────────────────────────────────────────────

export type DraftStatus = "unchanged" | "modified" | "deleted" | "added";
export type AmendmentType = "partial" | "full";

export interface DraftArticle {
  id: string;
  status: DraftStatus;
  current: DraftArticleContent;
  originalContent: DraftArticleContent | null;
  comment: string;
}

export interface DraftArticleContent {
  article_type: ArticleType;
  title: string | null;
  content: string | null;
  order_index: number;
}

export interface Draft {
  id: string;
  name: string;
  amendmentType: AmendmentType;
  updatedAt: string;
  partialContent: DraftArticle[];
  fullContent: DraftArticleContent[];
  treeContent: DraftTreeArticle[];
  originalTreeContent: DraftTreeArticle[];
}

export interface DraftTreeArticle {
  id: string;
  /** 沿革識別碼：對應原法規條文，送審時用以辨識「同一條」而非刪除重建 */
  lineage_id?: string | null;
  parent_id: string | null;
  sort_index: number;
  order_index: number;
  article_type: ArticleType;
  title: string;
  content: string;
  legal_number?: string | null;
  comment?: string;
}

export const ARTICLE_TYPE_LABEL: Record<string, string> = {
  volume: "編", chapter: "章", section: "節",
  article: "條", paragraph: "項",
  subparagraph: "款", item: "目",
  special_clause: "附則",
};

// ── localStorage 工具（含 schema versioning） ─────────────────────────────────

const DRAFT_SCHEMA_VERSION = 1;

interface DraftEnvelope {
  version: number;
  drafts: Draft[];
}

export function storageKey(regId: string) { return `amendment_drafts_${regId}`; }

function migrateDrafts(rawDrafts: unknown[]): Draft[] {
  return rawDrafts.filter((draft): draft is Draft => {
    if (!draft || typeof draft !== "object") return false;
    const d = draft as Record<string, unknown>;
    return typeof d.id === "string" && typeof d.name === "string";
  });
}

export function loadDrafts(regId: string): Draft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(regId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return migrateDrafts(parsed);
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as DraftEnvelope).drafts)) {
      const envelope = parsed as DraftEnvelope;
      return migrateDrafts(envelope.drafts);
    }
    return [];
  } catch {
    return [];
  }
}

export function saveDrafts(regId: string, drafts: Draft[]) {
  if (typeof window === "undefined") return;
  try {
    const envelope: DraftEnvelope = { version: DRAFT_SCHEMA_VERSION, drafts };
    window.localStorage.setItem(storageKey(regId), JSON.stringify(envelope));
  } catch { /* ignore quota or serialization errors */ }
}

export function newId() { return `d${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export function articleToContent(a: RegulationArticleOut): DraftArticleContent {
  return { article_type: a.article_type, title: a.title, content: a.content, order_index: a.order_index };
}

export function articleToTreeArticle(a: RegulationArticleOut): DraftTreeArticle {
  return {
    id: a.id,
    lineage_id: a.lineage_id ?? null,
    parent_id: a.parent_id ?? null,
    sort_index: a.sort_index,
    order_index: a.order_index ?? 0,
    article_type: a.article_type,
    title: a.title ?? "",
    content: a.content ?? "",
    legal_number: a.legal_number ?? null,
  };
}

export function fallbackTreeContent(draft: Draft): DraftTreeArticle[] {
  if (draft.treeContent?.length) return draft.treeContent;
  const source = draft.fullContent.length ? draft.fullContent : draft.partialContent.map(item => item.current);
  return source.map((item, index) => ({
    id: newId(),
    parent_id: null,
    sort_index: index + 1,
    order_index: index,
    article_type: item.article_type,
    title: item.title ?? "",
    content: item.content ?? "",
    legal_number: null,
    comment: "",
  }));
}

export function getSubtreeInsertIndex(items: DraftTreeArticle[], anchorId: string) {
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

export function getTreeChangeSummary(draft: Draft) {
  const current = fallbackTreeContent(draft);
  const baseline = draft.originalTreeContent?.length ? draft.originalTreeContent : [];
  const original = new Map(
    baseline.map(item => [
      item.id,
      {
        article_type: item.article_type,
        title: item.title,
        content: item.content,
        parent_id: item.parent_id,
        order_index: item.order_index,
      },
    ]),
  );
  const currentIds = new Set(current.map(item => item.id));
  const commonIds = new Set([...currentIds].filter(id => original.has(id)));
  const rankIn = (items: DraftTreeArticle[]) =>
    new Map(
      items
        .filter(item => commonIds.has(item.id))
        .slice()
        .sort((a, b) => a.sort_index - b.sort_index)
        .map((item, index) => [item.id, index] as const),
    );
  const baseRank = rankIn(baseline);
  const currRank = rankIn(current);
  const rows: Array<{
    id: string;
    status: "新增" | "修改" | "移動" | "刪除";
    type: ArticleType;
    title: string;
  }> = [];

  for (const item of current) {
    const base = original.get(item.id);
    if (!base) {
      rows.push({ id: item.id, status: "新增", type: item.article_type, title: item.title || "（未命名）" });
      continue;
    }
    const contentChanged =
      base.article_type !== item.article_type ||
      base.title !== item.title ||
      base.content !== item.content;
    const moved =
      base.parent_id !== item.parent_id || baseRank.get(item.id) !== currRank.get(item.id);
    if (contentChanged) {
      rows.push({ id: item.id, status: "修改", type: item.article_type, title: item.title || "（未命名）" });
    } else if (moved) {
      rows.push({ id: item.id, status: "移動", type: item.article_type, title: item.title || "（未命名）" });
    }
  }

  for (const item of baseline) {
    if (!currentIds.has(item.id)) {
      rows.push({
        id: `${item.id}-deleted`,
        status: "刪除",
        type: item.article_type,
        title: item.title || "（未命名）",
      });
    }
  }

  return rows;
}

export function buildDraftComparisonRows(draft: Draft) {
  const current = fallbackTreeContent(draft)
    .sort((a, b) => a.sort_index - b.sort_index);
  const baseline = (draft.originalTreeContent ?? [])
    .sort((a, b) => a.sort_index - b.sort_index);

  const originalById = new Map(baseline.map(item => [item.id, item]));
  const currentById = new Map(current.map(item => [item.id, item]));
  const commonIds = new Set(current.filter(item => originalById.has(item.id)).map(item => item.id));
  const baseRank = new Map(
    baseline.filter(item => commonIds.has(item.id)).map((item, index) => [item.id, index] as const),
  );
  const currRank = new Map(
    current.filter(item => commonIds.has(item.id)).map((item, index) => [item.id, index] as const),
  );
  const rows: Array<{
    id: string;
    article_key: string;
    status: "新增" | "修改" | "移動" | "刪除";
    revised_text: string;
    current_text: string;
    note: string;
  }> = [];

  for (const item of current) {
    const original = originalById.get(item.id);
    const revisedText = [item.title, item.content].filter(Boolean).join("　").trim();
    if (!original) {
      rows.push({
        id: item.id,
        article_key: item.title || ARTICLE_TYPE_LABEL[item.article_type] || "新增條文",
        status: "新增",
        revised_text: revisedText || "—",
        current_text: "—",
        note: item.comment?.trim() || "",
      });
      continue;
    }
    const originalText = [original.title, original.content].filter(Boolean).join("　").trim();
    const contentChanged = original.title !== item.title || original.content !== item.content;
    const moved =
      original.parent_id !== item.parent_id || baseRank.get(item.id) !== currRank.get(item.id);
    if (contentChanged || moved) {
      rows.push({
        id: item.id,
        article_key: item.title || original.title || ARTICLE_TYPE_LABEL[item.article_type] || "條文",
        status: contentChanged ? "修改" : "移動",
        revised_text: revisedText || "—",
        current_text: originalText || "—",
        note: item.comment?.trim() || "",
      });
    }
  }

  for (const item of baseline) {
    if (!currentById.has(item.id)) {
      rows.push({
        id: `deleted-${item.id}`,
        article_key: item.title || ARTICLE_TYPE_LABEL[item.article_type] || "刪除條文",
        status: "刪除",
        revised_text: "—",
        current_text: [item.title, item.content].filter(Boolean).join("　").trim() || "—",
        note: item.comment?.trim() || "",
      });
    }
  }

  return rows;
}
