import type { RegulationRevisionOut } from "@/lib/types";

const HISTORY_BREAK_RE =
  /\s+(?=(?:中華民國|民國)\s*\d{2,4}\s*年|\d{2,4}\s*學年度|\d{2,4}[./-]\d{1,2}[./-]\d{1,2})/g;

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function chineseNumber(value: number): string {
  if (value <= 0) return String(value);
  if (value < 10) return CN_DIGITS[value];
  if (value === 10) return "十";
  if (value < 20) return `十${CN_DIGITS[value % 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${CN_DIGITS[tens]}十${ones ? CN_DIGITS[ones] : ""}`;
  }
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return `${CN_DIGITS[hundreds]}百${rest ? chineseNumber(rest) : ""}`;
}

function academicTerm(date: Date) {
  const month = date.getMonth() + 1;
  if (month >= 8) {
    return { year: date.getFullYear() - 1911, semester: "第一" };
  }
  return {
    year: date.getFullYear() - 1912,
    semester: month === 1 ? "第一" : "第二",
  };
}

export function splitLegislativeHistory(value: string | null | undefined): string[] {
  const text = value?.trim();
  if (!text) return [];
  return text
    .replace(HISTORY_BREAK_RE, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatGeneratedHistoryRows(
  revisions: Pick<RegulationRevisionOut, "amended_at">[],
): string[] {
  const counters = new Map<string, number>();

  return [...revisions]
    .sort((a, b) => new Date(a.amended_at).getTime() - new Date(b.amended_at).getTime())
    .map((revision) => {
      const amendedAt = new Date(revision.amended_at);
      const term = academicTerm(amendedAt);
      const key = `${term.year}-${term.semester}`;
      const nextCount = (counters.get(key) ?? 0) + 1;
      counters.set(key, nextCount);
      return `${term.year}學年度第${term.semester}學期第${chineseNumber(nextCount)}次學生議會修訂`;
    });
}
