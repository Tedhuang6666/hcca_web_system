export type ArticleHeading = {
  id: string;
  level: 2 | 3;
  label: string;
};

function cleanHeadingLabel(value: string): string {
  return value
    .replace(/\s+#+\s*$/u, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_`~]/gu, "")
    .trim();
}

/** 從文章 Markdown 取出可供目錄與標題共用的錨點。 */
export function extractArticleHeadings(markdown: string | null | undefined): ArticleHeading[] {
  if (!markdown) return [];

  const headings: ArticleHeading[] = [];
  const pattern = /^(#{2,3})[ \t]+(.+?)[ \t]*$/gmu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    const label = cleanHeadingLabel(match[2]);
    if (!label) continue;
    headings.push({
      id: `article-section-${headings.length}`,
      level: match[1].length as 2 | 3,
      label,
    });
  }

  return headings;
}

export function articleReadingTime(markdown: string | null | undefined): number {
  const words = (markdown ?? "")
    .replace(/[#*_`>\[\]()/!-]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 260));
}

export function articleTitleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#(?!#)[ \t]+(.+?)[ \t]*$/mu)?.[1];
  return heading ? cleanHeadingLabel(heading) : "";
}

export function articleSummaryFromMarkdown(markdown: string): string {
  const summary = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!") && !line.startsWith("- "))
    .find((line) => !line.startsWith(">"));
  return cleanHeadingLabel(summary ?? "").slice(0, 160);
}

export function articleSlugFromTitle(title: string): string {
  const ascii = title
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 56);
  return ascii || `article-${Date.now()}`;
}
