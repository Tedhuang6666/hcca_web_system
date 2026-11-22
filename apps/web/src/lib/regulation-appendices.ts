import type { RegulationArticleOut } from "./types";

const APPENDIX_PATTERN = /附錄\s*[（(]([一二三四五六七八九十百\d]+)[）)]/g;

export type RegulationAppendix = { label: string; anchor: string; articleId: string | null };

export function regulationAppendices(articles: RegulationArticleOut[], content: string): RegulationAppendix[] {
  const active = articles.filter((article) => !article.is_deleted);
  const text = [...active.map((article) => `${article.title}\n${article.content ?? ""}`), content].join("\n");
  const numbers = [...new Set(Array.from(text.matchAll(APPENDIX_PATTERN), (match) => match[1]))];
  return numbers.map((number, index) => {
    const article = active.find((entry) => {
      const heading = entry.title.trim().match(/^附錄\s*[（(]([一二三四五六七八九十百\d]+)[）)]/);
      return heading?.[1] === number && Boolean(entry.content?.trim());
    });
    return { label: `附錄（${number}）`, anchor: `law-appendix-${index + 1}`, articleId: article?.id ?? null };
  });
}

export function appendixTextParts(text: string) {
  return text.split(/(附錄\s*[（(][一二三四五六七八九十百\d]+[）)])/g);
}
