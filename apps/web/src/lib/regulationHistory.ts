import type { RegulationRevisionOut } from "@/lib/types";

const HISTORY_BREAK_RE =
  /\s+(?=(?:中華民國|民國)\s*\d{2,4}\s*年|\d{2,4}\s*學年度|\d{2,4}[./-]\d{1,2}[./-]\d{1,2})/g;

export function splitLegislativeHistory(value: string | null | undefined): string[] {
  const text = value?.trim();
  if (!text) return [];
  return text
    .replace(HISTORY_BREAK_RE, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatRevisionDate(
  revision: Pick<RegulationRevisionOut, "amended_at" | "amended_at_precision" | "amended_year">,
): string {
  if (revision.amended_at_precision === "unknown") return "日期未知";
  if (revision.amended_at_precision === "year") {
    return revision.amended_year ? `${revision.amended_year}年` : "年份未知";
  }
  if (revision.amended_at_precision === "month") {
    const date = new Date(revision.amended_at);
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }
  return new Date(revision.amended_at).toLocaleDateString("zh-TW");
}
