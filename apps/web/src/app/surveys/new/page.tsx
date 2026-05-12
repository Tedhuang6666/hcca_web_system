"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { surveysApi, ApiError } from "@/lib/api";
import type { QuestionType } from "@/lib/types";

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "text",     label: "簡答（單行）" },
  { value: "textarea", label: "長答（多行）" },
  { value: "single",   label: "單選" },
  { value: "multiple", label: "多選" },
  { value: "rating",   label: "評分（1–5）" },
  { value: "date",     label: "日期" },
];

interface DraftQuestion {
  id: string;
  question_text: string;
  question_type: QuestionType;
  is_required: boolean;
  options: string[];
  min_value: number;
  max_value: number;
  placeholder: string;
  order_index: number;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

export default function NewSurveyPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // 問卷基本資料
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState("");
  const [orgId, setOrgId] = useState("");

  // 題目列表
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [newQ, setNewQ] = useState<Partial<DraftQuestion>>({
    question_text: "", question_type: "text", is_required: true, options: [], min_value: 1, max_value: 5, placeholder: "",
  });
  const [optionInput, setOptionInput] = useState("");

  useEffect(() => {
    setOrgId(localStorage.getItem("org_id") ?? "");
  }, []);

  const addOption = () => {
    const opt = optionInput.trim();
    if (!opt) return;
    setNewQ(prev => ({ ...prev, options: [...(prev.options ?? []), opt] }));
    setOptionInput("");
  };

  const removeOption = (i: number) => {
    setNewQ(prev => ({ ...prev, options: (prev.options ?? []).filter((_, j) => j !== i) }));
  };

  const addQuestion = () => {
    if (!newQ.question_text?.trim()) { toast.error("請輸入題目文字"); return; }
    const needsOptions = newQ.question_type === "single" || newQ.question_type === "multiple";
    if (needsOptions && (!newQ.options || newQ.options.length < 2)) {
      toast.error("選擇題至少需要 2 個選項"); return;
    }
    setQuestions(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        question_text: newQ.question_text!,
        question_type: newQ.question_type ?? "text",
        is_required: newQ.is_required ?? true,
        options: newQ.options ?? [],
        min_value: newQ.min_value ?? 1,
        max_value: newQ.max_value ?? 5,
        placeholder: newQ.placeholder ?? "",
        order_index: prev.length,
      },
    ]);
    setNewQ({ question_text: "", question_type: "text", is_required: true, options: [], min_value: 1, max_value: 5, placeholder: "" });
    setOptionInput("");
  };

  const removeQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const save = async () => {
    if (!title.trim()) { toast.error("請輸入問卷標題"); return; }
    if (questions.length === 0) { toast.error("請至少新增一道題目"); return; }
    if (!orgId) { toast.error("無法取得組織資訊"); return; }
    setSaving(true);
    try {
      const survey = await surveysApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        is_anonymous: isAnonymous,
        allow_multiple: allowMultiple,
        closes_at: closesAt || undefined,
        org_id: orgId,
      });
      // 依序新增題目
      for (const q of questions) {
        await surveysApi.addQuestion(survey.id, {
          question_text: q.question_text,
          question_type: q.question_type,
          is_required: q.is_required,
          options: q.options,
          min_value: q.question_type === "rating" ? q.min_value : undefined,
          max_value: q.question_type === "rating" ? q.max_value : undefined,
          placeholder: q.placeholder || undefined,
          order_index: q.order_index,
        });
      }
      toast.success("問卷草稿已建立");
      router.push(`/surveys/${survey.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally { setSaving(false); }
  };

  const needsOptions = newQ.question_type === "single" || newQ.question_type === "multiple";
  const isRating = newQ.question_type === "rating";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* 頁首 */}
      <div className="flex items-center gap-3">
        <Link href="/surveys" className="topbar-icon-btn" aria-label="返回問卷列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>新增問卷</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>建立草稿後可開放填答</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 主欄 */}
        <div className="lg:col-span-2 space-y-4">

          {/* 基本資訊 */}
          <div className="card p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>基本資訊</h3>
            <div>
              <Label>問卷標題 *</Label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="請輸入問卷標題…" className="input" />
            </div>
            <div>
              <Label>描述說明</Label>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                rows={2} placeholder="問卷目的或填答說明…" className="input resize-y" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)}
                  className="accent-sky-400" />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>匿名填答</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allowMultiple} onChange={e => setAllowMultiple(e.target.checked)}
                  className="accent-sky-400" />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>允許重複填答</span>
              </label>
            </div>
            <div>
              <Label>截止時間（選填）</Label>
              <input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)}
                className="input" style={{ colorScheme: "dark" }} />
            </div>
          </div>

          {/* 題目列表 */}
          {questions.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  已加入的題目（{questions.length}）
                </h3>
              </div>
              <ul>
                {questions.map((q, idx) => (
                  <li key={q.id}
                    className="flex items-start gap-3 px-5 py-3.5"
                    style={idx < questions.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                    <span className="text-xs font-bold mt-0.5 w-5 flex-shrink-0" style={{ color: "var(--primary)" }}>
                      Q{idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{q.question_text}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {QUESTION_TYPES.find(t => t.value === q.question_type)?.label}
                        {q.is_required && " · 必填"}
                        {q.options.length > 0 && ` · ${q.options.length} 個選項`}
                      </p>
                    </div>
                    <button onClick={() => removeQuestion(q.id)}
                      className="flex-shrink-0 transition-colors hover:text-red-400"
                      style={{ color: "var(--text-muted)" }} aria-label="刪除題目">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 新增題目 */}
          <div className="card p-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>新增題目</h3>
            <div>
              <Label>題目文字 *</Label>
              <textarea
                value={newQ.question_text}
                onChange={e => setNewQ(p => ({ ...p, question_text: e.target.value }))}
                rows={2}
                placeholder="請輸入題目…"
                className="input resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>題型</Label>
                <select value={newQ.question_type}
                  onChange={e => setNewQ(p => ({ ...p, question_type: e.target.value as QuestionType, options: [] }))}
                  className="input">
                  {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 mt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newQ.is_required ?? true}
                    onChange={e => setNewQ(p => ({ ...p, is_required: e.target.checked }))}
                    className="accent-sky-400" />
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>必填</span>
                </label>
              </div>
            </div>

            {/* 評分範圍 */}
            {isRating && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>最小分數</Label>
                  <input type="number" min={1} max={9} value={newQ.min_value}
                    onChange={e => setNewQ(p => ({ ...p, min_value: parseInt(e.target.value) || 1 }))}
                    className="input" />
                </div>
                <div>
                  <Label>最大分數</Label>
                  <input type="number" min={2} max={10} value={newQ.max_value}
                    onChange={e => setNewQ(p => ({ ...p, max_value: parseInt(e.target.value) || 5 }))}
                    className="input" />
                </div>
              </div>
            )}

            {/* 選項 */}
            {needsOptions && (
              <div className="space-y-2">
                <Label>選項（至少 2 個）</Label>
                {(newQ.options ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(newQ.options ?? []).map((opt, i) => (
                      <span key={i} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
                        style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                        {opt}
                        <button onClick={() => removeOption(i)} className="ml-0.5 hover:text-red-400" aria-label={`移除 ${opt}`}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={optionInput}
                    onChange={e => setOptionInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
                    placeholder="輸入選項後按 Enter 或點擊新增"
                    className="input flex-1 text-sm"
                  />
                  <button onClick={addOption} className="btn btn-ghost flex-shrink-0">新增選項</button>
                </div>
              </div>
            )}

            <button onClick={addQuestion} className="btn btn-ghost w-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              加入此題目
            </button>
          </div>
        </div>

        {/* 右欄：儲存 */}
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <button onClick={save} disabled={saving} className="btn btn-primary w-full" aria-busy={saving}>
              {saving ? "儲存中…" : "儲存草稿"}
            </button>
            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              儲存後可開放填答或繼續編輯
            </p>
          </div>

          <div className="card p-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>問卷設定</h3>
            <div className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              <p>{questions.length} 道題目</p>
              <p>{isAnonymous ? "匿名填答" : "記名填答"}</p>
              <p>{allowMultiple ? "允許重複填答" : "每人限填一次"}</p>
              {closesAt && <p>截止：{new Date(closesAt).toLocaleString("zh-TW")}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
