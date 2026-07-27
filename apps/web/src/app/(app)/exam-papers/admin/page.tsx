"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError, examPapersApi } from "@/lib/api";
import type {
  ExamGradeTrack,
  ExamPaperDownloadOut,
  ExamPaperListItem,
  ExamTraceInspectOut,
} from "@/lib/types";

const tracks: { value: ExamGradeTrack; label: string }[] = [
  { value: "first", label: "一類" },
  { value: "second", label: "二類" },
  { value: "third", label: "三類" },
];

const panelStyle = { background: "var(--bg-surface)", borderColor: "var(--border)" };
const nestedStyle = { background: "var(--bg-elevated)", borderColor: "var(--border)" };
const labelClass = "min-w-0 text-sm font-medium text-[var(--text-secondary)]";
const mutedClass = "text-sm text-[var(--text-muted)]";
const requiredMark = <span className="ml-1 text-[var(--danger)]">*</span>;
const fileInputClass =
  "block w-full min-w-0 text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--bg-hover)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--text-primary)]";

const TRACK_LABEL: Record<ExamGradeTrack, string> = {
  first: "一類",
  second: "二類",
  third: "三類",
};

function gradeName(grade: number) {
  return ["高一", "高二", "高三"][grade - 1] ?? `高${grade}`;
}

function paperScope(paper: ExamPaperListItem) {
  const track = paper.grade_track ? TRACK_LABEL[paper.grade_track] : "";
  return `${paper.academic_year} 學年 · 第 ${paper.semester} 學期 · ${gradeName(paper.grade)}${track} · 第 ${paper.exam_number} 次`;
}

export default function ExamPaperAdminPage() {
  const [papers, setPapers] = useState<ExamPaperListItem[]>([]);
  const [downloads, setDownloads] = useState<ExamPaperDownloadOut[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<string>("");
  const [traceResult, setTraceResult] = useState<ExamTraceInspectOut | null>(null);
  const [form, setForm] = useState({
    title: "",
    grade: "1",
    semester: "1",
    grade_track: "",
    subject: "",
    academic_year: "",
    exam_number: "1",
    is_published: false,
  });
  const [file, setFile] = useState<File | null>(null);

  const subjectOptions = useMemo(() => {
    const scoped = papers.filter((paper) => {
      if (paper.grade !== Number(form.grade)) return false;
      if (paper.semester !== Number(form.semester)) return false;
      if (form.grade_track && paper.grade_track !== form.grade_track) return false;
      return true;
    });
    return Array.from(new Set(scoped.map((paper) => paper.subject))).sort((a, b) =>
      a.localeCompare(b, "zh-Hant"),
    );
  }, [form.grade, form.grade_track, form.semester, papers]);

  const load = async () => {
    try {
      setPapers(await examPapersApi.list({ include_unpublished: true }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "讀取題庫失敗");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const upload = async () => {
    const title = form.title.trim();
    const subject = form.subject.trim();
    const academicYear = Number(form.academic_year);
    if (!file) {
      toast.error("請選擇 PDF");
      return;
    }
    if (file.type && file.type !== "application/pdf") {
      toast.error("只能上傳 PDF 檔案");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("檔案副檔名必須是 .pdf");
      return;
    }
    if (!title) {
      toast.error("請輸入標題");
      return;
    }
    if (!subject) {
      toast.error("請輸入科目");
      return;
    }
    if (!Number.isInteger(academicYear) || academicYear < 1 || academicYear > 999) {
      toast.error("請輸入有效學年，例如 114");
      return;
    }
    if (form.grade !== "1" && !form.grade_track) {
      toast.error("高二、高三需選擇類組");
      return;
    }
    try {
      await examPapersApi.create({
        file,
        title,
        subject,
        academic_year: academicYear,
        semester: Number(form.semester),
        grade: Number(form.grade),
        grade_track: form.grade === "1" ? null : (form.grade_track as ExamGradeTrack),
        exam_number: Number(form.exam_number),
        is_published: form.is_published,
      });
      toast.success("已上傳段考題");
      setFile(null);
      setForm((value) => ({ ...value, title: "", subject: "" }));
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "上傳失敗");
    }
  };

  const togglePublished = async (paper: ExamPaperListItem) => {
    try {
      await examPapersApi.update(paper.id, { is_published: !paper.is_published });
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新失敗");
    }
  };

  const showDownloads = async (paper: ExamPaperListItem) => {
    setSelectedPaper(paper.id);
    try {
      setDownloads(await examPapersApi.downloads(paper.id));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "讀取下載紀錄失敗");
    }
  };

  const inspect = async (candidate: File | null) => {
    if (!candidate) return;
    try {
      setTraceResult(await examPapersApi.inspectTrace(candidate));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "判斷失敗");
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-5 text-[var(--text-primary)] sm:px-5 sm:py-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">題庫管理</h1>
      </header>

      <section className="rounded-lg border p-4" style={panelStyle}>
        <h2 className="text-base font-semibold">上傳段考題</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            年級{requiredMark}
            <select
              className="input mt-1 w-full"
              required
              aria-required="true"
              value={form.grade}
              onChange={(e) =>
                setForm((value) => ({ ...value, grade: e.target.value, grade_track: "" }))
              }>
              <option value="1">高一</option>
              <option value="2">高二</option>
              <option value="3">高三</option>
            </select>
          </label>
          <label className={labelClass}>
            學期{requiredMark}
            <select
              className="input mt-1 w-full"
              required
              aria-required="true"
              value={form.semester}
              onChange={(e) => setForm((value) => ({ ...value, semester: e.target.value }))}>
              <option value="1">第一學期</option>
              <option value="2">第二學期</option>
            </select>
          </label>
          <label className={labelClass}>
            類組{form.grade === "1" ? null : requiredMark}
            <select
              className="input mt-1 w-full"
              value={form.grade_track}
              required={form.grade !== "1"}
              aria-required={form.grade !== "1"}
              disabled={form.grade === "1"}
              onChange={(e) => setForm((value) => ({ ...value, grade_track: e.target.value }))}>
              <option value="">不分組</option>
              {tracks.map((track) => (
                <option key={track.value} value={track.value}>
                  {track.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            科目{requiredMark}
            <input
              className="input mt-1 w-full"
              list="exam-paper-subjects"
              placeholder="例如：數學"
              required
              aria-required="true"
              value={form.subject}
              onChange={(e) => setForm((value) => ({ ...value, subject: e.target.value }))}
            />
            <datalist id="exam-paper-subjects">
              {subjectOptions.map((subject) => (
                <option key={subject} value={subject} />
              ))}
            </datalist>
          </label>
          <label className={labelClass}>
            學年{requiredMark}
            <input
              className="input mt-1 w-full"
              placeholder="114"
              inputMode="numeric"
              required
              aria-required="true"
              pattern="[0-9]*"
              value={form.academic_year}
              onChange={(e) => setForm((value) => ({ ...value, academic_year: e.target.value }))}
            />
          </label>
          <label className={labelClass}>
            段考{requiredMark}
            <select
              className="input mt-1 w-full"
              required
              aria-required="true"
              value={form.exam_number}
              onChange={(e) => setForm((value) => ({ ...value, exam_number: e.target.value }))}>
              <option value="1">第一次段考</option>
              <option value="2">第二次段考</option>
              <option value="3">第三次段考</option>
            </select>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            標題{requiredMark}
            <input
              className="input mt-1 w-full"
              required
              aria-required="true"
              value={form.title}
              onChange={(e) => setForm((value) => ({ ...value, title: e.target.value }))}
            />
          </label>
          <label className="flex min-w-0 items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) => setForm((value) => ({ ...value, is_published: e.target.checked }))}
            />
            立即上架
          </label>
          <label className="min-w-0 sm:col-span-2 lg:col-span-3">
            <span className={labelClass}>PDF 檔案{requiredMark}</span>
            <input
              className={`${fileInputClass} mt-2`}
              type="file"
              accept="application/pdf"
              required
              aria-required="true"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            className="btn btn-primary inline-flex w-full items-center justify-center gap-2 self-end"
            onClick={upload}>
            <Upload size={16} /> 上傳
          </button>
        </div>
      </section>

      <section className="rounded-lg border p-4" style={panelStyle}>
        <h2 className="text-base font-semibold">外流檔案判斷</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <input
            className={fileInputClass}
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => inspect(e.target.files?.[0] ?? null)}
          />
          <span className={mutedClass}>PDF metadata / 頁面文字 / 圖片最佳努力掃描</span>
        </div>
        {traceResult && (
          <div className="mt-4 space-y-2 text-sm">
            {traceResult.unsupported_reason && (
              <p className="text-[var(--warning)]">{traceResult.unsupported_reason}</p>
            )}
            <p>偵測到追蹤碼：{traceResult.detected_trace_codes.join("、") || "無"}</p>
            {traceResult.matches.map((match) => (
              <div key={match.download_id} className="rounded-lg border p-3" style={nestedStyle}>
                <div className="break-words font-medium">{match.paper_title}</div>
                <div className="break-words">
                  {match.user_display_name} · {match.user_student_id ?? match.user_email}
                </div>
                <div className="break-words font-mono text-xs">
                  {match.trace_code} · {new Date(match.downloaded_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 rounded-lg border p-4" style={panelStyle}>
          <h2 className="text-base font-semibold">題目清單</h2>
          <div className="mt-3 divide-y divide-[var(--border)]">
            {papers.map((paper) => (
              <div
                key={paper.id}
                className="flex min-w-0 flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="break-words font-medium">{paper.title}</div>
                  <div className={`break-words ${mutedClass}`}>
                    {paper.subject} · {paperScope(paper)}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 md:flex md:flex-shrink-0">
                  <button className="btn btn-ghost min-w-0" onClick={() => togglePublished(paper)}>
                    {paper.is_published ? "下架" : "上架"}
                  </button>
                  <button
                    className="btn btn-ghost inline-flex min-w-0 items-center justify-center gap-2"
                    onClick={() => showDownloads(paper)}>
                    <Search size={15} /> 紀錄
                  </button>
                  <a
                    className="btn btn-ghost inline-flex min-w-0 items-center justify-center gap-2"
                    href={examPapersApi.downloadUrl(paper.id)}>
                    <Download size={15} /> 測試
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="min-w-0 rounded-lg border p-4" style={panelStyle}>
          <h2 className="text-base font-semibold">下載紀錄</h2>
          {!selectedPaper && <p className={`mt-3 ${mutedClass}`}>選擇一份題目查看紀錄。</p>}
          <div className="mt-3 space-y-3">
            {downloads.map((row) => (
              <div key={row.id} className="rounded-lg border p-3 text-sm" style={nestedStyle}>
                <div className="break-words font-medium">{row.user_display_name}</div>
                <div className="break-words text-[var(--text-muted)]">
                  {row.user_student_id ?? row.user_email}
                </div>
                <div className="mt-1 break-words font-mono text-xs">{row.trace_code}</div>
                <div className="mt-1 text-[var(--text-muted)]">
                  {new Date(row.downloaded_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
