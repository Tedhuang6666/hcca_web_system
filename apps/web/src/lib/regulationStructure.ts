/**
 * 法規條文結構共用工具（純函數，無 React hooks）。
 * 供 server component（public/regulations/*）與 client component（regulations/*）共用，
 * 確保「新建立的憲章頁面」與「既有竹中憲章頁面」的編號與層級顯示完全一致。
 */

export type ArticleStructureType =
  | "volume" | "chapter" | "section"
  | "article" | "paragraph" | "subparagraph" | "item"
  | "special_clause";

export const ARTICLE_TYPE_LABEL: Record<ArticleStructureType, string> = {
  volume: "編", chapter: "章", section: "節",
  article: "條", paragraph: "項", subparagraph: "款", item: "目",
  special_clause: "附則",
};

export const ARTICLE_IS_STRUCTURAL: Record<ArticleStructureType, boolean> = {
  volume: true, chapter: true, section: true,
  article: false, paragraph: false, subparagraph: false, item: false,
  special_clause: false,
};

export const STRUCTURAL_INDENT: Record<ArticleStructureType, number> = {
  volume: 0, chapter: 1, section: 2,
  article: 0, paragraph: 1, subparagraph: 2, item: 3,
  special_clause: 0,
};

export function normalizeArticleType(t: string): ArticleStructureType {
  return t as ArticleStructureType;
}

// ── 層級順序與巢狀規則 ────────────────────────────────────────────────────────

/** 正式層級的線性順序（不含 special_clause），用於計算 rank、決定升降級。 */
export const ARTICLE_TYPE_ORDER: ArticleStructureType[] = [
  "volume", "chapter", "section", "article", "paragraph", "subparagraph", "item",
];

/** 取得層級在 ARTICLE_TYPE_ORDER 中的索引；不在順序中（如 special_clause）回傳 -1。 */
export function typeRank(t: ArticleStructureType | string): number {
  return ARTICLE_TYPE_ORDER.indexOf(normalizeArticleType(t));
}

/**
 * 父子層級規則（與後端 services/regulation.py `_PARENT_RULES` 對齊）。
 * `_root` 代表 parent_id = null。
 * 注意：chapter 下可放 section 或 article（章可以不分節，直接列條）。
 */
export const PARENT_RULES: Record<ArticleStructureType | "_root", Set<ArticleStructureType>> = {
  _root: new Set(["volume", "chapter", "section", "article", "special_clause"]),
  volume: new Set(["chapter"]),
  chapter: new Set(["section", "article"]),
  section: new Set(["article"]),
  article: new Set(["paragraph"]),
  paragraph: new Set(["subparagraph"]),
  subparagraph: new Set(["item"]),
  item: new Set(),
  special_clause: new Set(),
};

/**
 * 是否可將 child 巢入 parent 之下。
 * parent=null 視為根層級（不能放 paragraph / subparagraph / item — 防止「款」「目」單獨存在）。
 */
export function canNestInside(
  parentType: ArticleStructureType | string | null,
  childType: ArticleStructureType | string,
): boolean {
  const child = normalizeArticleType(childType);
  if (parentType === null) {
    return PARENT_RULES._root.has(child);
  }
  const parent = normalizeArticleType(parentType);
  return PARENT_RULES[parent]?.has(child) ?? false;
}

/**
 * 取得 parent 之下允許的子層級類型清單。
 * 給新增條文時的下拉選單做防呆過濾。
 */
export function allowedChildTypes(
  parentType: ArticleStructureType | string | null,
): ArticleStructureType[] {
  const set = parentType === null
    ? PARENT_RULES._root
    : PARENT_RULES[normalizeArticleType(parentType)] ?? new Set();
  return Array.from(set);
}

/** 取得 parent 之下「預設的子層級」（清單第一個）。 */
export function childTypeOf(parentType: ArticleStructureType | string): ArticleStructureType | null {
  const types = allowedChildTypes(parentType);
  return types[0] ?? null;
}

/** 取得 child 之上「最近的合法父層級」（用於升級操作）。 */
export function parentTypeOf(childType: ArticleStructureType | string): ArticleStructureType | null {
  const child = normalizeArticleType(childType);
  for (const [parent, allowed] of Object.entries(PARENT_RULES) as Array<[ArticleStructureType | "_root", Set<ArticleStructureType>]>) {
    if (parent === "_root") continue;
    if (allowed.has(child)) {
      return parent as ArticleStructureType;
    }
  }
  return null;
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

// ── 章節摺疊的顯示列計算 ────────────────────────────────────────────────────

export interface ArticleDisplayRow<T extends DisplayLabelArticle = DisplayLabelArticle> {
  article: T;
  index: number;
  displayLabel: string;
  hiddenByChapter: boolean;
}

function chineseDigit(value: number): string {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 0) return String(value);
  if (value < 10) return digits[value];
  if (value === 10) return "十";
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(value);
}

function listMarkerFromLegalNumber(legalNumber: string | undefined, fallback: number): string {
  if (!legalNumber) return chineseDigit(fallback);
  return /^\d+$/.test(legalNumber) ? chineseDigit(Number(legalNumber)) : legalNumber;
}

/**
 * 為每一條文計算「顯示用標籤」（第 X 章 / 第 X 條 / 一、 / （一）…）並標示是否被章節摺疊隱藏。
 * 用於 LawTree 與 RegulationDetailSections 的 ArticleRow。
 */
export function buildArticleDisplayRows<T extends DisplayLabelArticle & { id: string; article_type: string; legal_number?: string | null }>(
  articles: T[],
  chapterCollapsedMap: Record<string, boolean> = {},
): ArticleDisplayRow<T>[] {
  let volumeCount = 0;
  let chapterCount = 0;
  let sectionCount = 0;
  let articleCount = 0;
  let paragraphCount = 0;
  let subparagraphCount = 0;
  let itemCount = 0;
  let currentChapterId: string | null = null;

  return articles.map((article, index) => {
    const type = normalizeArticleType(article.article_type);
    let displayLabel = ARTICLE_TYPE_LABEL[type] ?? article.article_type;
    const legalNumber = article.legal_number?.trim();

    switch (type) {
      case "volume":
        volumeCount += 1;
        chapterCount = 0;
        sectionCount = 0;
        displayLabel = `第 ${legalNumber || volumeCount} 編`;
        currentChapterId = null;
        break;
      case "chapter":
        chapterCount += 1;
        sectionCount = 0;
        displayLabel = `第 ${legalNumber || chapterCount} 章`;
        currentChapterId = article.id;
        break;
      case "section":
        sectionCount += 1;
        displayLabel = `第 ${legalNumber || sectionCount} 節`;
        break;
      case "article":
        articleCount += 1;
        paragraphCount = 0;
        subparagraphCount = 0;
        itemCount = 0;
        displayLabel = `第 ${legalNumber || articleCount} 條`;
        break;
      case "paragraph":
        paragraphCount += 1;
        subparagraphCount = 0;
        itemCount = 0;
        displayLabel = `第 ${legalNumber || paragraphCount} 項`;
        break;
      case "subparagraph":
        subparagraphCount += 1;
        itemCount = 0;
        displayLabel = `${listMarkerFromLegalNumber(legalNumber, subparagraphCount)}、`;
        break;
      case "item":
        itemCount += 1;
        displayLabel = `（${listMarkerFromLegalNumber(legalNumber, itemCount)}）`;
        break;
      case "special_clause":
        displayLabel = "附則";
        break;
      default:
        break;
    }

    return {
      article,
      index,
      displayLabel,
      hiddenByChapter: Boolean(
        currentChapterId
        && chapterCollapsedMap[currentChapterId]
        && article.id !== currentChapterId,
      ),
    };
  });
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
