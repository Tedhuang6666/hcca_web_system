export type ExamScopeEntry = {
  id: string;
  subject: string;
  section: string;
  grade: string;
  gradeGroup: string;
  content: string;
};

export type ExamScopeData = {
  entries: ExamScopeEntry[];
  subjects: string[];
  grades: string[];
  sections: string[];
};

const headingPattern = /^(#{1,3})[ \t]+(.+?)[ \t]*$/u;
const separatorPattern = /^[*_\-]{3,}[ \t]*$/u;
const gradePattern = /^(高[一二三])/u;

function cleanLabel(value: string): string {
  return value.replace(/\s+#+\s*$/u, "").trim();
}

function gradeGroup(label: string): string {
  return label.match(gradePattern)?.[1] ?? label;
}

function sectionRank(section: string): number {
  if (section === "計分方式") return 0;
  const examNumber = section.match(/^([一二三])段$/u)?.[1];
  return examNumber ? "一二三".indexOf(examNumber) + 1 : 10;
}

function isScoreDetail(label: string): boolean {
  return /(?:考試|成績).*(?:%|％)|(?:%|％).*?(?:考試|成績)/u.test(label);
}

/**
 * 讀取「科目 → 段考 → 年級」的 Markdown 結構。
 *
 * 部分來源會將年級的計分說明誤標成二級標題；只要它位於「計分方式」的
 * 年級之後，就把它視為該年級的正文，讓公開閱讀不會因一個標記失誤斷裂。
 */
export function parseExamScopeMarkdown(markdown: string | null | undefined): ExamScopeData | null {
  if (!markdown?.trim()) return null;

  const entries: ExamScopeEntry[] = [];
  let currentSubject = "";
  let currentSection = "";
  let currentEntry: ExamScopeEntry | null = null;

  const appendContent = (value: string) => {
    if (!currentEntry) return;
    currentEntry.content = currentEntry.content
      ? `${currentEntry.content}\n${value}`
      : value;
  };

  for (const line of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const heading = line.match(headingPattern);
    if (heading) {
      const level = heading[1].length;
      const label = cleanLabel(heading[2]);
      if (!label) continue;

      if (level === 1) {
        currentSubject = label;
        currentSection = "";
        currentEntry = null;
        continue;
      }

      if (level === 2) {
        if (currentSection === "計分方式" && currentEntry && isScoreDetail(label)) {
          appendContent(label);
          continue;
        }
        currentSection = label;
        currentEntry = null;
        continue;
      }

      if (!currentSubject || !currentSection) continue;
      currentEntry = {
        id: `exam-scope-entry-${entries.length}`,
        subject: currentSubject,
        section: currentSection,
        grade: label,
        gradeGroup: gradeGroup(label),
        content: "",
      };
      entries.push(currentEntry);
      continue;
    }

    if (separatorPattern.test(line.trim())) continue;
    appendContent(line);
  }

  const contentEntries = entries.filter((entry) => entry.content.trim());
  const subjects = [...new Set(contentEntries.map((entry) => entry.subject))];
  const grades = [...new Set(contentEntries.map((entry) => entry.gradeGroup))];
  const sections = [...new Set(contentEntries.map((entry) => entry.section))]
    .sort((left, right) => sectionRank(left) - sectionRank(right) || left.localeCompare(right, "zh-TW"));

  const isExamScope = subjects.length >= 2
    && grades.some((grade) => gradePattern.test(grade))
    && sections.some((section) => /^[一二三]段$/u.test(section));

  return isExamScope ? { entries: contentEntries, subjects, grades, sections } : null;
}
