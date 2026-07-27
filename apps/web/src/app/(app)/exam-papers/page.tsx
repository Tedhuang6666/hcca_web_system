"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Filter } from "lucide-react";
import { toast } from "sonner";
import { ApiError, examPapersApi } from "@/lib/api";
import type { ExamGradeTrack, ExamPaperListItem } from "@/lib/types";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";

const TRACK_LABEL: Record<ExamGradeTrack, string> = {
  first: "一類",
  second: "二類",
  third: "三類",
};

const cardClass = "rounded-lg border p-4 shadow-sm";
const labelClass = "min-w-0 text-sm font-medium text-[var(--text-secondary)]";
const mutedClass = "text-sm text-[var(--text-muted)]";
const panelStyle = { background: "var(--bg-surface)", borderColor: "var(--border)" };

function gradeName(grade: number) {
  return ["高一", "高二", "高三"][grade - 1] ?? `高${grade}`;
}

function gradeLabel(paper: ExamPaperListItem) {
  return paper.grade_track ? `${gradeName(paper.grade)}${TRACK_LABEL[paper.grade_track]}` : gradeName(paper.grade);
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const EXAM_CATALOG_KEY = "exam-papers/catalog";
const EXAM_PAPERS_KEY = "exam-papers/list";

export default function ExamPapersPage() {
  const [catalog, setCatalog] = useState<ExamPaperListItem[]>(() => cacheGet<ExamPaperListItem[]>(EXAM_CATALOG_KEY) ?? []);
  const [papers, setPapers] = useState<ExamPaperListItem[]>(() => cacheGet<ExamPaperListItem[]>(EXAM_PAPERS_KEY) ?? []);
  const [loading, setLoading] = useState(!cacheHas(EXAM_PAPERS_KEY));
  const [filters, setFilters] = useState({
    grade: "",
    semester: "",
    grade_track: "",
    subject: "",
    academic_year: "",
    exam_number: "",
  });

  const params = useMemo(
    () => ({
      grade: filters.grade ? Number(filters.grade) : undefined,
      semester: filters.semester ? Number(filters.semester) : undefined,
      grade_track: (filters.grade_track || undefined) as ExamGradeTrack | undefined,
      subject: filters.subject || undefined,
      academic_year: filters.academic_year ? Number(filters.academic_year) : undefined,
      exam_number: filters.exam_number ? Number(filters.exam_number) : undefined,
    }),
    [filters],
  );

  const subjectOptions = useMemo(() => {
    const scoped = catalog.filter((paper) => {
      if (filters.grade && paper.grade !== Number(filters.grade)) return false;
      if (filters.semester && paper.semester !== Number(filters.semester)) return false;
      if (filters.grade_track && paper.grade_track !== filters.grade_track) return false;
      return true;
    });
    return Array.from(new Set(scoped.map((paper) => paper.subject))).sort((a, b) =>
      a.localeCompare(b, "zh-Hant"),
    );
  }, [catalog, filters.grade, filters.semester, filters.grade_track]);

  const loadCatalog = async () => {
    if (cacheHas(EXAM_CATALOG_KEY)) return;
    try {
      const data = await examPapersApi.list();
      setCatalog(data);
      cacheSet(EXAM_CATALOG_KEY, data);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "讀取段考題失敗");
    }
  };

  const load = async () => {
    if (!cacheHas(EXAM_PAPERS_KEY)) setLoading(true);
    try {
      const data = await examPapersApi.list(params);
      setPapers(data);
      // 只有無篩選條件時才快取
      const hasFilters = Object.values(params).some((v) => v !== undefined);
      if (!hasFilters) cacheSet(EXAM_PAPERS_KEY, data);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "讀取段考題失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (filters.subject && subjectOptions.length > 0 && !subjectOptions.includes(filters.subject)) {
      setFilters((value) => ({ ...value, subject: "" }));
    }
  }, [filters.subject, subjectOptions]);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "grade") {
        next.grade_track = "";
        next.subject = "";
      }
      if (key === "semester" || key === "grade_track") next.subject = "";
      return next;
    });
  };

  const download = async (paper: ExamPaperListItem) => {
    try {
      const res = await fetch(examPapersApi.downloadUrl(paper.id), { credentials: "include" });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${paper.title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("下載失敗，請確認帳號具校內成員資格");
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 text-[var(--text-primary)] sm:px-5 sm:py-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">段考題庫</h1>
      </header>

      <section
        className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-6"
        style={panelStyle}
        aria-label="篩選段考題">
        <label className={labelClass}>
          年級
          <select
            className="input mt-1 w-full"
            value={filters.grade}
            onChange={(e) => updateFilter("grade", e.target.value)}>
            <option value="">全部</option>
            <option value="1">高一</option>
            <option value="2">高二</option>
            <option value="3">高三</option>
          </select>
        </label>
        <label className={labelClass}>
          學期
          <select
            className="input mt-1 w-full"
            value={filters.semester}
            onChange={(e) => updateFilter("semester", e.target.value)}>
            <option value="">全部</option>
            <option value="1">第一學期</option>
            <option value="2">第二學期</option>
          </select>
        </label>
        <label className={labelClass}>
          類組
          <select
            className="input mt-1 w-full"
            value={filters.grade_track}
            disabled={filters.grade === "1"}
            onChange={(e) => updateFilter("grade_track", e.target.value)}>
            <option value="">全部</option>
            <option value="first">一類</option>
            <option value="second">二類</option>
            <option value="third">三類</option>
          </select>
        </label>
        <label className={labelClass}>
          科目
          <select
            className="input mt-1 w-full"
            value={filters.subject}
            onChange={(e) => updateFilter("subject", e.target.value)}>
            <option value="">全部</option>
            {subjectOptions.map((subject) => (
              <option key={subject} value={subject}>
                {subject}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          學年
          <input
            className="input mt-1 w-full"
            inputMode="numeric"
            value={filters.academic_year}
            onChange={(e) => updateFilter("academic_year", e.target.value)}
          />
        </label>
        <label className={labelClass}>
          段考
          <select
            className="input mt-1 w-full"
            value={filters.exam_number}
            onChange={(e) => updateFilter("exam_number", e.target.value)}>
            <option value="">全部</option>
            <option value="1">第一次</option>
            <option value="2">第二次</option>
            <option value="3">第三次</option>
          </select>
        </label>
      </section>

      <div className={["flex items-center gap-2", mutedClass].join(" ")}>
        <Filter size={15} /> {loading ? "載入中" : `共 ${papers.length} 份`}
      </div>

      <section className="grid gap-3">
        {papers.map((paper) => (
          <article key={paper.id} className={cardClass} style={panelStyle}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="break-words text-base font-semibold">{paper.title}</h2>
                <p className={`mt-1 break-words ${mutedClass}`}>
                  {paper.subject} · {paper.academic_year} 學年 · 第 {paper.semester} 學期 ·{" "}
                  {gradeLabel(paper)} · 第 {paper.exam_number} 次段考 · {fileSize(paper.file_size)}
                </p>
              </div>
              <button
                className="btn btn-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
                onClick={() => download(paper)}>
                <Download size={16} /> 下載
              </button>
            </div>
          </article>
        ))}
        {!loading && papers.length === 0 && (
          <p className={`py-10 text-center ${mutedClass}`}>沒有符合條件的段考題。</p>
        )}
      </section>
    </main>
  );
}
