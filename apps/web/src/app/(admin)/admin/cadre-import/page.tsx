"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, FileUp, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { adminApi } from "@/lib/api";
import type { CadreDirectoryImportOut } from "@/lib/types";

const DEFAULT_TERM_START = "2026-08-01";
const DEFAULT_TERM_END = "2027-07-31";

function ResultMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}

export default function CadreImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [academicYear, setAcademicYear] = useState("115");
  const [termStart, setTermStart] = useState(DEFAULT_TERM_START);
  const [termEnd, setTermEnd] = useState(DEFAULT_TERM_END);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CadreDirectoryImportOut | null>(null);

  const submit = async () => {
    if (!file) {
      toast.error("請先選擇幹部通訊錄 PDF");
      return;
    }
    const year = Number(academicYear);
    if (!Number.isInteger(year) || year < 1) {
      toast.error("請填寫有效的學年度");
      return;
    }
    setSubmitting(true);
    try {
      const imported = await adminApi.importHchsCadreDirectory(file, {
        academicYear: year,
        termStart,
        termEnd: termEnd || null,
      });
      setResult(imported);
      toast.success("班聯會幹部名冊已匯入");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "幹部名冊匯入失敗");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--primary)" }}>組織與職位</p>
          <h1 className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>班聯會幹部名冊匯入</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
            上傳 Google 表單匯出的通訊錄 PDF，一次完成重新分班後的班級與座號、帳號預建、部門職位、權限與任期設定。
          </p>
        </div>
        <Link href="/admin/permissions" className="btn btn-ghost btn-sm">查看職位與權限</Link>
      </div>

      <section className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-start gap-3">
          <div className="rounded-lg p-2" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}><FileUp size={20} /></div>
          <div>
            <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>一鍵套用範圍</h2>
            <ul className="mt-2 space-y-1 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
              <li>PDF 的學號、班級與座號會覆蓋名冊中的舊編班資料。</li>
              <li>秘書處、學權、活動、公關、財務、新聞、設計、攝影與資訊部會自動建立職位和任期。</li>
              <li>同一份 PDF 可安全重複匯入；既有帳號與相同任期不會重複建立。</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="sm:col-span-3">
            <span className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>幹部通訊錄 PDF</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border p-2 text-sm"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>學年度</span>
            <input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} inputMode="numeric" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>任期開始</span>
            <input type="date" value={termStart} onChange={(event) => setTermStart(event.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>任期結束</span>
            <input type="date" value={termEnd} onChange={(event) => setTermEnd(event.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-start gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <ShieldCheck className="mt-0.5 shrink-0" size={16} />
            <span>原始 PDF 只用於這次匯入解析，不會另存為平台附件。</span>
          </div>
          <button type="button" onClick={() => void submit()} disabled={submitting} className="btn btn-primary min-h-11">
            {submitting ? "匯入中…" : "一鍵匯入名冊"}
          </button>
        </div>
      </section>

      {result && (
        <section className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <Users size={19} style={{ color: "var(--primary)" }} />
            <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>匯入完成</h2>
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            已處理 {result.source_rows} 筆通訊錄資料，套用 {result.cadre_members} 位幹部；班級涵蓋 {result.class_codes.join("、")}。
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultMetric label="新建帳號" value={result.users_created} />
            <ResultMetric label="沿用帳號" value={result.users_reused} />
            <ResultMetric label="新增職位" value={result.positions_created} />
            <ResultMetric label="新增任期" value={result.assignments_created} />
            <ResultMetric label="新增權限" value={result.permissions_added} />
            <ResultMetric label="新增班級名冊" value={result.roster_created} />
            <ResultMetric label="更新班級名冊" value={result.roster_updated} />
            <ResultMetric label="新增組織" value={result.orgs_created} />
          </div>
        </section>
      )}

      <section className="rounded-xl p-4 text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
        <div className="flex gap-2"><FileText className="mt-0.5 shrink-0" size={16} /><p>會議編輯時以「組織成員」匯入出列席名冊；確認議程後，系統會自動寄送電子通知並附上正式版開會通知單 PDF。</p></div>
      </section>
    </main>
  );
}
