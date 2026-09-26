"use client";

import { useMemo, useState } from "react";
import { BookOpenCheck, ListFilter, RotateCcw } from "lucide-react";

import type { ExamScopeData, ExamScopeEntry } from "@/lib/exam-scope";

import ArticleMarkdown from "./ArticleMarkdown";

type BrowseOrder = "subject" | "grade";

const ALL = "all";

function entryTitle(entry: ExamScopeEntry, order: BrowseOrder): string {
  if (order === "subject") return entry.grade;
  const variant = entry.grade === entry.gradeGroup
    ? ""
    : entry.grade.replace(`${entry.gradeGroup}－`, "");
  return variant ? `${entry.subject}（${variant}）` : entry.subject;
}

export default function ExamScopeExplorer({ scope }: { scope: ExamScopeData }) {
  const [order, setOrder] = useState<BrowseOrder>("subject");
  const [subject, setSubject] = useState(ALL);
  const [grade, setGrade] = useState(ALL);
  const [section, setSection] = useState(ALL);
  const examSections = scope.sections.filter((item) => item !== "計分方式");

  const visibleEntries = useMemo(
    () => scope.entries.filter((entry) => (
      (subject === ALL || entry.subject === subject)
      && (grade === ALL || entry.gradeGroup === grade)
      && (section === ALL || entry.section === section)
    )),
    [grade, scope.entries, section, subject],
  );
  const primaryGroups = order === "subject" ? scope.subjects : scope.grades;

  const reset = () => {
    setOrder("subject");
    setSubject(ALL);
    setGrade(ALL);
    setSection(ALL);
  };

  return (
    <section className="exam-scope" aria-labelledby="exam-scope-title">
      <div className="exam-scope-controls" aria-label="考試範圍查詢條件">
        <fieldset className="exam-scope-order-control">
          <legend>排列方式</legend>
          <div className="exam-scope-choice-row">
            <button
              type="button"
              className={order === "subject" ? "is-selected" : undefined}
              aria-pressed={order === "subject"}
              onClick={() => setOrder("subject")}
            >
              依科目
            </button>
            <button
              type="button"
              className={order === "grade" ? "is-selected" : undefined}
              aria-pressed={order === "grade"}
              onClick={() => setOrder("grade")}
            >
              依年級
            </button>
          </div>
        </fieldset>

        <fieldset className="exam-scope-subject-control">
          <legend>科目</legend>
          <div className="exam-scope-choice-row">
            <button
              type="button"
              className={subject === ALL ? "is-selected" : undefined}
              aria-pressed={subject === ALL}
              onClick={() => setSubject(ALL)}
            >
              全部科目
            </button>
            {scope.subjects.map((item) => (
              <button
                key={item}
                type="button"
                className={subject === item ? "is-selected" : undefined}
                aria-pressed={subject === item}
                onClick={() => setSubject(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="exam-scope-grade-control">
          <legend>年級</legend>
          <div className="exam-scope-choice-row">
            <button
              type="button"
              className={grade === ALL ? "is-selected" : undefined}
              aria-pressed={grade === ALL}
              onClick={() => setGrade(ALL)}
            >
              全部年級
            </button>
            {scope.grades.map((item) => (
              <button
                key={item}
                type="button"
                className={grade === item ? "is-selected" : undefined}
                aria-pressed={grade === item}
                onClick={() => setGrade(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="exam-scope-section-control">
          <legend>段考次數</legend>
          <div className="exam-scope-choice-row">
            <button
              type="button"
              className={section === ALL ? "is-selected" : undefined}
              aria-pressed={section === ALL}
              onClick={() => setSection(ALL)}
            >
              全部段考
            </button>
            {examSections.map((item) => (
              <button
                key={item}
                type="button"
                className={section === item ? "is-selected" : undefined}
                aria-pressed={section === item}
                onClick={() => setSection(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>

        {(order !== "subject" || subject !== ALL || grade !== ALL || section !== ALL) && (
          <button type="button" className="exam-scope-reset" onClick={reset}>
            <RotateCcw size={15} aria-hidden /> 重設查詢
          </button>
        )}
      </div>

      <div className="exam-scope-result-bar" aria-live="polite">
        <span><ListFilter size={16} aria-hidden /> 顯示 {visibleEntries.length} 筆範圍</span>
        <span>{order === "subject" ? "依科目排列" : "依年級排列"}</span>
      </div>

      {visibleEntries.length > 0 ? (
        <div className="exam-scope-groups">
          {primaryGroups.map((primary) => {
            const groupEntries = visibleEntries.filter((entry) => (
              order === "subject" ? entry.subject === primary : entry.gradeGroup === primary
            ));
            if (groupEntries.length === 0) return null;

            return (
              <section className="exam-scope-group" key={primary} aria-labelledby={`exam-scope-${order}-${primary}`}>
                <h3 id={`exam-scope-${order}-${primary}`}>{primary}</h3>
                {scope.sections.map((section) => {
                  const sectionEntries = groupEntries.filter((entry) => entry.section === section);
                  if (sectionEntries.length === 0) return null;

                  return (
                    <section className="exam-scope-stage" key={section} aria-labelledby={`exam-scope-${order}-${primary}-${section}`}>
                      <h4 id={`exam-scope-${order}-${primary}-${section}`}>{section}</h4>
                      <div className="exam-scope-entries">
                        {sectionEntries.map((entry) => (
                          <article className="exam-scope-entry" key={entry.id}>
                            <h5>{entryTitle(entry, order)}</h5>
                            <ArticleMarkdown markdown={entry.content} />
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="exam-scope-empty" role="status">
          目前沒有符合這些條件的範圍，請調整科目或年級。
        </div>
      )}
    </section>
  );
}
