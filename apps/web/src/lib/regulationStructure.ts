/**
 * 法規條文結構共用工具（純函數，無 React hooks）。
 * 供 server component（public/regulations/*）與 client component（regulations/*）共用，
 * 確保「新建立的憲章頁面」與「既有竹中憲章頁面」的編號與層級顯示完全一致。
 */

export type ArticleStructureType =
  | "volume" | "chapter" | "section"
  | "article" | "paragraph" | "subparagraph" | "item"
  | "special_clause"
  // 舊值向下相容
  | "clause" | "subsection";

export const ARTICLE_TYPE_LABEL: Record<ArticleStructureType, string> = {
  volume: "編", chapter: "章", section: "節",
  article: "條", paragraph: "項", subparagraph: "款", item: "目",
  special_clause: "附則",
  clause: "條", subsection: "款",
};

export const ARTICLE_IS_STRUCTURAL: Record<ArticleStructureType, boolean> = {
  volume: true, chapter: true, section: true,
  article: false, paragraph: false, subparagraph: false, item: false,
  special_clause: false,
  clause: false, subsection: false,
};

export const STRUCTURAL_INDENT: Record<ArticleStructureType, number> = {
  volume: 0, chapter: 1, section: 2,
  article: 0, paragraph: 1, subparagraph: 2, item: 3,
  special_clause: 0,
  clause: 0, subsection: 2,
};

/** 將舊值正規化為新值（clause → article、subsection → subparagraph）。 */
export function normalizeArticleType(t: string): ArticleStructureType {
  if (t === "clause") return "article";
  if (t === "subsection") return "subparagraph";
  return t as ArticleStructureType;
}

// ── 層級順序與巢狀規則 ────────────────────────────────────────────────────────

/** 正式層級的線性順序（不含 special_clause 與舊值），用於計算 rank、決定升降級。 */
export const ARTICLE_TYPE_ORDER: ArticleStructureType[] = [
  "volume", "chapter", "section", "article", "paragraph", "subparagraph", "item",
];

/** 取得層級在 ARTICLE_TYPE_ORDER 中的索引；不在順序中（如 special_clause / 舊值）回傳 -1。 */
export function typeRank(t: ArticleStructureType | string): number {
  return ARTICLE_TYPE_ORDER.indexOf(normalizeArticleType(t));
}

/**
 * 是否可將 child 巢入 parent 之下。
 * 規則：child 的 rank 必須等於 parent 的 rank + 1（嚴格相鄰），這與後端 _PARENT_RULES 一致。
 * 例外：根層級（parent=null）允許 volume / chapter / section / article。
 */
export function canNestInside(
  parentType: ArticleStructureType | string | null,
  childType: ArticleStructureType | string,
): boolean {
  const child = normalizeArticleType(childType);
  if (parentType === null) {
    return child === "volume" || child === "chapter" || child === "section" || child === "article";
  }
  const parent = normalizeArticleType(parentType);
  const parentRank = typeRank(parent);
  const childRank = typeRank(child);
  return parentRank >= 0 && childRank >= 0 && childRank === parentRank + 1;
}

/** 取得 parent 之下「下一級」的層級類型（用於降級操作）。 */
export function childTypeOf(parentType: ArticleStructureType | string): ArticleStructureType | null {
  const parent = normalizeArticleType(parentType);
  const rank = typeRank(parent);
  if (rank < 0 || rank >= ARTICLE_TYPE_ORDER.length - 1) return null;
  return ARTICLE_TYPE_ORDER[rank + 1];
}

/** 取得 child 之上「上一級」的層級類型（用於升級操作）。 */
export function parentTypeOf(childType: ArticleStructureType | string): ArticleStructureType | null {
  const child = normalizeArticleType(childType);
  const rank = typeRank(child);
  if (rank <= 0) return null;
  return ARTICLE_TYPE_ORDER[rank - 1];
}

// ── 視覺元資料 ────────────────────────────────────────────────────────────────

export interface ArticleTypeMeta {
  /** 桌面縮排（px） */
  indentDesktop: number;
  /** 手機縮排（px） */
  indentMobile: number;
  /** Tailwind 字級 class 名 */
  textSize: "text-base" | "text-sm" | "text-xs";
  /** Tailwind 字重 class 名 */
  fontWeight: "font-bold" | "font-semibold" | "font-medium" | "font-normal";
  /** 左邊框寬度（px） */
  borderWidth: number;
  /** 左邊框 CSS 顏色（var 或 hex） */
  borderColor: string;
  /** 徽章背景色 */
  badgeBg: string;
  /** 徽章文字色 */
  badgeColor: string;
}

/**
 * 每種層級的視覺元資料，供 LawArticleRow 與 LawTreeEditor 使用。
 * 縮排採累進：每往下一層加 20px（桌面）/ 10px（手機），讓七層階層一望即知。
 * 配色由深到淺：volume/chapter 為彩色，section 之下為金/邊框/灰系。
 */
export const ARTICLE_TYPE_META: Record<ArticleStructureType, ArticleTypeMeta> = {
  volume: {
    indentDesktop: 0, indentMobile: 0,
    textSize: "text-base", fontWeight: "font-bold",
    borderWidth: 4, borderColor: "var(--primary)",
    badgeBg: "var(--primary)", badgeColor: "var(--primary-fg)",
  },
  chapter: {
    indentDesktop: 20, indentMobile: 10,
    textSize: "text-base", fontWeight: "font-semibold",
    borderWidth: 3, borderColor: "#d97706",
    badgeBg: "rgba(217,119,6,0.12)", badgeColor: "#9a3d0c",
  },
  section: {
    indentDesktop: 40, indentMobile: 20,
    textSize: "text-sm", fontWeight: "font-semibold",
    borderWidth: 2, borderColor: "var(--primary-hover)",
    badgeBg: "var(--primary-dim)", badgeColor: "var(--primary-hover)",
  },
  article: {
    indentDesktop: 60, indentMobile: 30,
    textSize: "text-sm", fontWeight: "font-medium",
    borderWidth: 2, borderColor: "var(--border-strong)",
    badgeBg: "var(--bg-hover)", badgeColor: "var(--text-primary)",
  },
  paragraph: {
    indentDesktop: 80, indentMobile: 40,
    textSize: "text-xs", fontWeight: "font-medium",
    borderWidth: 1, borderColor: "var(--border)",
    badgeBg: "var(--bg-hover)", badgeColor: "var(--text-secondary)",
  },
  subparagraph: {
    indentDesktop: 100, indentMobile: 50,
    textSize: "text-xs", fontWeight: "font-normal",
    borderWidth: 1, borderColor: "var(--border)",
    badgeBg: "var(--bg-elevated)", badgeColor: "var(--text-muted)",
  },
  item: {
    indentDesktop: 120, indentMobile: 60,
    textSize: "text-xs", fontWeight: "font-normal",
    borderWidth: 1, borderColor: "var(--border)",
    badgeBg: "var(--bg-elevated)", badgeColor: "var(--text-muted)",
  },
  special_clause: {
    indentDesktop: 0, indentMobile: 0,
    textSize: "text-sm", fontWeight: "font-medium",
    borderWidth: 3, borderColor: "var(--text-muted)",
    badgeBg: "var(--bg-hover)", badgeColor: "var(--text-muted)",
  },
  // 舊值向下相容（與 article / subparagraph 同視覺）
  clause: {
    indentDesktop: 60, indentMobile: 30,
    textSize: "text-sm", fontWeight: "font-medium",
    borderWidth: 2, borderColor: "var(--border-strong)",
    badgeBg: "var(--bg-hover)", badgeColor: "var(--text-primary)",
  },
  subsection: {
    indentDesktop: 100, indentMobile: 50,
    textSize: "text-xs", fontWeight: "font-normal",
    borderWidth: 1, borderColor: "var(--border)",
    badgeBg: "var(--bg-elevated)", badgeColor: "var(--text-muted)",
  },
};

export interface DisplayLabelArticle {
  id: string;
  article_type: string;
  legal_number?: string | null;
  title?: string | null;
  sort_index?: number;
}

/**
 * 為條文計算顯示編號（第 X 章 / 第 X 條 / 第 X 項…）。
 * volume 重置 chapter/section/article 計數；chapter 重置 section/article；
 * 以此保持「同層級獨立計數、新章節從 1 重新開始」的習慣。
 */
export function computeArticleDisplayLabels<T extends DisplayLabelArticle>(
  articles: T[],
): Record<string, string> {
  const counters: Record<string, number> = {
    volume: 0, chapter: 0, section: 0,
    article: 0, paragraph: 0, subparagraph: 0, item: 0, special_clause: 0,
  };
  const result: Record<string, string> = {};

  const ordered = articles[0]?.sort_index !== undefined
    ? [...articles].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
    : articles;

  for (const a of ordered) {
    const t = normalizeArticleType(a.article_type);
    if (t === "volume") {
      counters.volume += 1; counters.chapter = 0; counters.section = 0; counters.article = 0;
    } else if (t === "chapter") {
      counters.chapter += 1; counters.section = 0; counters.article = 0;
    } else if (t === "section") {
      counters.section += 1;
    } else if (t === "article") {
      counters.article += 1;
    } else if (t === "paragraph") {
      counters.paragraph += 1;
    } else if (t === "subparagraph") {
      counters.subparagraph += 1;
    } else if (t === "item") {
      counters.item += 1;
    } else if (t === "special_clause") {
      counters.special_clause += 1;
    }

    const label = ARTICLE_TYPE_LABEL[t] ?? t;
    const num = a.legal_number?.trim() || String(counters[t] ?? 0);
    const titlePart = a.title?.trim() ? ` ${a.title}` : "";

    result[a.id] = ARTICLE_IS_STRUCTURAL[t]
      ? `第 ${num} ${label}${titlePart}`.trim()
      : `第 ${num} ${label}${titlePart}`.trim();
  }
  return result;
}

// ── 簡潔徽章（純層級名，給 LawArticleRow 使用） ──────────────────────────────

/** 計算「第 N 章/節/條/…」這種簡潔徽章內容（不附 title）。 */
export function computeArticleBadgeText<T extends DisplayLabelArticle>(
  articles: T[],
): Record<string, string> {
  const counters: Record<string, number> = {
    volume: 0, chapter: 0, section: 0,
    article: 0, paragraph: 0, subparagraph: 0, item: 0, special_clause: 0,
  };
  const result: Record<string, string> = {};

  const ordered = articles[0]?.sort_index !== undefined
    ? [...articles].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
    : articles;

  for (const a of ordered) {
    const t = normalizeArticleType(a.article_type);
    if (t === "volume") {
      counters.volume += 1; counters.chapter = 0; counters.section = 0; counters.article = 0;
    } else if (t === "chapter") {
      counters.chapter += 1; counters.section = 0; counters.article = 0;
    } else if (t === "section") {
      counters.section += 1;
    } else if (t === "article") {
      counters.article += 1;
    } else if (t === "paragraph") {
      counters.paragraph += 1;
    } else if (t === "subparagraph") {
      counters.subparagraph += 1;
    } else if (t === "item") {
      counters.item += 1;
    } else if (t === "special_clause") {
      counters.special_clause += 1;
    }

    const label = ARTICLE_TYPE_LABEL[t] ?? t;
    if (t === "special_clause") {
      result[a.id] = label;
    } else {
      const num = a.legal_number?.trim() || String(counters[t] ?? 0);
      result[a.id] = `第 ${num} ${label}`;
    }
  }
  return result;
}
