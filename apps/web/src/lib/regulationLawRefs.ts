/**
 * 法規條文連結解析工具。
 *
 * 從 `apps/web/src/app/regulations/[id]/RegulationDetailPageClient.tsx` 提取，
 * 共用於法規詳情頁、條文連結錨點、版本對比視圖等需要把中文編號（一、二、十）
 * 與「第N條／項／款」字串雙向轉換的場景。
 */

import type { ArticleType } from "@/lib/types";

const CN_NUMERAL: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function chineseToInt(value: string): number {
  const raw = value.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  let total = 0;
  let current = 0;
  for (const char of raw) {
    if (char in CN_NUMERAL) current = CN_NUMERAL[char];
    else if (char === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else if (char === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else if (char === "千") {
      total += (current || 1) * 1000;
      current = 0;
    }
  }
  return total + current;
}

export function normalizedType(type: ArticleType): ArticleType {
  return type;
}

export const LINKABLE_ARTICLE_TYPES = new Set<ArticleType>([
  "volume",
  "chapter",
  "section",
  "article",
  "paragraph",
  "subparagraph",
  "item",
]);

export const ARTICLE_TYPE_SUFFIX: Partial<Record<ArticleType, string>> = {
  volume: "編",
  chapter: "章",
  section: "節",
  article: "條",
  paragraph: "項",
  subparagraph: "款",
  item: "目",
};

export const REF_SUFFIX_TYPE: Record<string, ArticleType> = {
  編: "volume",
  章: "chapter",
  節: "section",
  條: "article",
  項: "paragraph",
  款: "subparagraph",
  目: "item",
};

export type ParsedLawRef = {
  number: string;
  type: ArticleType;
};

export function normalizeLegalNumber(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw;
  if (/^[零〇一二兩三四五六七八九十百千]+$/.test(raw)) return String(chineseToInt(raw));
  return raw;
}

export function parseLawRef(value: string | null): ParsedLawRef | null {
  if (!value) return null;
  const match = value.match(/第\s*([零〇一二兩三四五六七八九十百千0-9]+)\s*([編章節條項款目])/);
  const type = match ? REF_SUFFIX_TYPE[match[2]] : null;
  if (!match || !type) return null;
  return {
    number: normalizeLegalNumber(match[1]),
    type,
  };
}

export function linkSegmentForArticle(
  type: ArticleType,
  legalNumber: string | null | undefined,
  fallback: string,
): string {
  const number =
    normalizeLegalNumber(legalNumber)
    || fallback.replace(/[第\s編章節條項款目、（）()]/g, "").trim()
    || "?";
  const suffix =
    ARTICLE_TYPE_SUFFIX[type] ?? ARTICLE_TYPE_SUFFIX[normalizedType(type)] ?? "條";
  return `第${number}${suffix}`;
}

export function decodeRouteSegment(value: string): string {
  let current = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}
