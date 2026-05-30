"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { surveysApi, orgsApi, ApiError } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import type { QuestionType, ValidationRule, UserSummary } from "@/lib/types";
import { uploadUrl } from "@/lib/config";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import UserPicker from "@/components/surveys/UserPicker";
import ActivitySelect from "@/components/activities/ActivitySelect";

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "section_text", label: "文字描述區塊" },
  { value: "page_break",   label: "分頁" },
  { value: "image",        label: "圖片" },
  { value: "video",        label: "影片連結" },
  { value: "text",     label: "簡答（單行）" },
  { value: "textarea", label: "長答（多行）" },
  { value: "single",   label: "單選" },
  { value: "multiple", label: "多選" },
  { value: "rating",   label: "評分（1–5）" },
  { value: "date",     label: "日期" },
];

const DISPLAY_TYPES: QuestionType[] = ["section_text", "page_break", "image", "video"];
const isDisplayType = (type: QuestionType | undefined) => Boolean(type && DISPLAY_TYPES.includes(type));

const VALIDATION_RULES: { value: ValidationRule | ""; label: string }[] = [
  { value: "",        label: "不限格式" },
  { value: "email",   label: "電子郵件" },
  { value: "number",  label: "數字（可含小數）" },
  { value: "integer", label: "整數" },
  { value: "url",     label: "網址" },
  { value: "phone",   label: "電話號碼" },
];

type CondRule = { question_id: string; operator: string; value: string; connector: string };

interface DraftQuestion {
  id: string;
  question_text: string;
  question_type: QuestionType;
  is_required: boolean;
  options: string[];
  min_value: number;
  max_value: number;
  placeholder: string;
  image_url: string;
  min_length: string;
  max_length: string;
  validation_rule: string;
  min_label: string;
  max_label: string;
  rules: CondRule[];
  order_index: number;
}

type SurveyDraft = {
  title: string;
  description: string;
  isAnonymous: boolean;
  allowMultiple: boolean;
  closesAt: string;
  orgId: string;
  activityId: string;
  questions: DraftQuestion[];
  newQ: Partial<DraftQuestion>;
  optionInput: string;
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

/** 本地圖片上傳欄位：可上傳、預覽、移除。 */
function ImageField({
  value, onChange, label, hint,
}: {
  value: string;
  onChange: (url: string) => void;
  label: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("請選擇圖片檔案"); return; }
    setUploading(true);
    try {
      const { url } = await surveysApi.uploadImage(file);
      onChange(url);
      toast.success("圖片已上傳");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "圖片上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Label>{label}</Label>
      {value ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={uploadUrl(value)} alt="圖片預覽" className="max-h-40 rounded-lg"
            style={{ border: "1px solid var(--border)" }} />
          <button type="button" onClick={() => onChange("")}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-sm"
            style={{ background: "var(--danger)", color: "white" }} aria-label="移除圖片">
            ×
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="btn btn-ghost w-full" aria-busy={uploading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {uploading ? "上傳中…" : "選擇圖片上傳"}
        </button>
      )}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{hint}</p>}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
    </div>
  );
}

/** 題目顯示條件編輯器（多規則、且／或、可排序）。 */
function ConditionEditor({
  rules, others, onChange,
}: {
  rules: CondRule[];
  others: { id: string; label: string; type: QuestionType; options: string[] }[];
  onChange: (rules: CondRule[]) => void;
}) {
  const update = (i: number, patch: Partial<CondRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= rules.length) return;
    const next = [...rules];
    [next[i], next[t]] = [next[t], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      {rules.map((r, i) => (
        <div key={i} className="space-y-1 rounded-lg p-2" style={{ background: "var(--bg-surface)" }}>
          {i > 0 && (
            <div className="flex gap-1">
              {(["and", "or"] as const).map(c => (
                <button key={c} type="button" onClick={() => update(i, { connector: c })}
                  className="text-xs px-2 py-0.5 rounded"
                  style={r.connector === c
                    ? { background: "var(--primary)", color: "var(--primary-fg)" }
                    : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                  {c === "and" ? "且" : "或"}
                </button>
              ))}
            </div>
          )}
          <select value={r.question_id} onChange={e => update(i, { question_id: e.target.value })}
            className="input text-sm">
            <option value="">選擇來源題目…</option>
            {others.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <div className="flex flex-wrap gap-1.5 items-center">
            <select value={r.operator} onChange={e => update(i, { operator: e.target.value })}
              className="input text-sm" style={{ flex: "1 1 6rem" }}>
              <option value="equals">完全等於</option>
              <option value="contains">包含</option>
            </select>
            {(() => {
              const src = others.find(o => o.id === r.question_id);
              const choices = src && (src.type === "single" || src.type === "multiple")
                ? src.options : [];
              return choices.length > 0 ? (
                <select value={r.value} onChange={e => update(i, { value: e.target.value })}
                  className="input text-sm" style={{ flex: "2 1 8rem" }}>
                  <option value="">選擇答案…</option>
                  {choices.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input value={r.value} onChange={e => update(i, { value: e.target.value })}
                  placeholder="答案文字" className="input text-sm" style={{ flex: "2 1 8rem" }} />
              );
            })()}
            <div className="flex gap-1 ml-auto">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                className="topbar-icon-btn" aria-label="上移" style={{ opacity: i === 0 ? 0.3 : 1 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rules.length - 1}
                className="topbar-icon-btn" aria-label="下移" style={{ opacity: i === rules.length - 1 ? 0.3 : 1 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              <button type="button" onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
                className="topbar-icon-btn" aria-label="刪除條件" style={{ color: "var(--danger)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ))}
      <button type="button"
        onClick={() => onChange([...rules, { question_id: "", operator: "equals", value: "", connector: "and" }])}
        className="btn btn-ghost w-full text-xs">＋ 新增顯示條件</button>
    </div>
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
  const [activityId, setActivityId] = useState("");
  const [orgs, setOrgs] = useState<OrgRead[]>([]);

  // 填答對象
  const [isPublic, setIsPublic] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState("");
  const [allowedUsers, setAllowedUsers] = useState<UserSummary[]>([]);
  const [allowedOrgIds, setAllowedOrgIds] = useState<string[]>([]);

  // 題目列表
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [newQ, setNewQ] = useState<Partial<DraftQuestion>>({
    question_text: "", question_type: "text", is_required: true, options: [], min_value: 1, max_value: 5,
    placeholder: "", image_url: "", min_length: "", max_length: "", validation_rule: "", min_label: "", max_label: "",
  });
  const [optionInput, setOptionInput] = useState("");

  useEffect(() => {
    const storedOrgId = localStorage.getItem("org_id") ?? "";
    orgsApi.list({ active_only: true })
      .then((items) => {
        const usableStoredOrgId = items.some((org) => org.id === storedOrgId) ? storedOrgId : "";
        setOrgs(items);
        setOrgId(usableStoredOrgId || (items.length === 1 ? items[0].id : ""));
      })
      .catch(() => {
        // 建立時仍會由後端權限檢查；這裡只避免 UI 直接卡死。
      });
  }, []);

  const draftValue = useMemo<SurveyDraft>(() => ({
    title,
    description,
    isAnonymous,
    allowMultiple,
    closesAt,
    orgId,
    activityId,
    questions,
    newQ,
    optionInput,
  }), [
    activityId,
    allowMultiple,
    closesAt,
    description,
    isAnonymous,
    newQ,
    optionInput,
    orgId,
    questions,
    title,
  ]);
  const restoreDraft = useCallback((draft: SurveyDraft) => {
    setTitle(draft.title ?? "");
    setDescription(draft.description ?? "");
    setIsAnonymous(Boolean(draft.isAnonymous));
    setAllowMultiple(Boolean(draft.allowMultiple));
    setClosesAt(draft.closesAt ?? "");
    setOrgId(draft.orgId ?? localStorage.getItem("org_id") ?? "");
    setActivityId(draft.activityId ?? "");
    setQuestions((draft.questions ?? []).map(q => ({ ...q, rules: q.rules ?? [] })));
    setNewQ(draft.newQ ?? {
      question_text: "",
      question_type: "text",
      is_required: true,
      options: [],
      min_value: 1,
      max_value: 5,
      placeholder: "",
      image_url: "",
      min_length: "",
      max_length: "",
      validation_rule: "",
      min_label: "",
      max_label: "",
    });
    setOptionInput(draft.optionInput ?? "");
    toast.info("已復原未送出的問卷草稿");
  }, []);
  const { clearDraft, flushDraft } = useDraftAutosave({
    key: "surveys:new",
    value: draftValue,
    onRestore: restoreDraft,
    isEmpty: useCallback((draft: SurveyDraft) => (
      !(draft.title ?? "").trim()
      && !(draft.description ?? "").trim()
      && !draft.closesAt
      && (draft.questions ?? []).length === 0
      && !(draft.newQ.question_text ?? "").trim()
      && !(draft.optionInput ?? "").trim()
    ), []),
  });

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
    const qType = newQ.question_type ?? "text";
    const isImg = qType === "image";
    if (isImg && !newQ.image_url) { toast.error("圖片題型請先上傳圖片"); return; }
    if (!isImg && !newQ.question_text?.trim()) { toast.error("請輸入題目或區塊文字"); return; }
    const needsOptions = qType === "single" || qType === "multiple";
    if (needsOptions && (!newQ.options || newQ.options.length < 2)) {
      toast.error("選擇題至少需要 2 個選項"); return;
    }
    const isText = qType === "text" || qType === "textarea";
    setQuestions(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        question_text: newQ.question_text?.trim() ?? "",
        question_type: qType,
        is_required: isDisplayType(qType) ? false : (newQ.is_required ?? true),
        options: newQ.options ?? [],
        min_value: newQ.min_value ?? 1,
        max_value: newQ.max_value ?? 5,
        placeholder: newQ.placeholder ?? "",
        image_url: newQ.image_url ?? "",
        min_length: isText ? (newQ.min_length ?? "") : "",
        max_length: isText ? (newQ.max_length ?? "") : "",
        validation_rule: isText ? (newQ.validation_rule ?? "") : "",
        min_label: qType === "rating" ? (newQ.min_label ?? "") : "",
        max_label: qType === "rating" ? (newQ.max_label ?? "") : "",
        rules: [],
        order_index: prev.length,
      },
    ]);
    // 保留上一題的題型與必填設定，方便連續新增同類型題目
    setNewQ({
      question_text: "",
      question_type: qType,
      is_required: newQ.is_required ?? true,
      options: [],
      min_value: newQ.min_value ?? 1,
      max_value: newQ.max_value ?? 5,
      placeholder: "",
      image_url: "",
      min_length: "",
      max_length: "",
      validation_rule: "",
      min_label: "",
      max_label: "",
    });
    setOptionInput("");
  };

  const removeQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const moveQuestion = (index: number, dir: -1 | 1) => {
    setQuestions(prev => {
      const t = index + dir;
      if (t < 0 || t >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[t]] = [next[t], next[index]];
      return next.map((q, i) => ({ ...q, order_index: i }));
    });
  };

  const setQuestionRules = (id: string, rules: CondRule[]) => {
    setQuestions(prev => prev.map(q => (q.id === id ? { ...q, rules } : q)));
  };

  const save = async (publish = false) => {
    if (!title.trim()) { toast.error("請輸入問卷標題"); return; }
    if (!questions.some(q => !isDisplayType(q.question_type))) { toast.error("請至少新增一道可填答題目"); return; }
    if (!orgId) { toast.error("無法取得組織資訊"); return; }
    setSaving(true);
    try {
      const splitLines = (s: string) => s.split("\n").map(x => x.trim()).filter(Boolean);
      const survey = await surveysApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        is_anonymous: isAnonymous,
        allow_multiple: allowMultiple,
        closes_at: closesAt || undefined,
        org_id: orgId,
        activity_id: activityId || null,
        is_public: isPublic,
        allowed_org_ids: isPublic ? [] : allowedOrgIds,
        allowed_user_ids: isPublic ? [] : allowedUsers.map(u => u.id),
        allowed_domains: isPublic ? [] : splitLines(allowedDomains),
      });
      // 第一輪：依序新增題目，建立「暫存 id → 真實 id」對應
      const idMap: Record<string, string> = {};
      for (const q of questions) {
        const isText = q.question_type === "text" || q.question_type === "textarea";
        const created = await surveysApi.addQuestion(survey.id, {
          question_text: q.question_text,
          question_type: q.question_type,
          is_required: q.is_required,
          options: q.options,
          min_value: q.question_type === "rating" ? q.min_value : undefined,
          max_value: q.question_type === "rating" ? q.max_value : undefined,
          placeholder: q.placeholder || undefined,
          image_url: q.image_url || undefined,
          min_length: isText && q.min_length ? parseInt(q.min_length) : undefined,
          max_length: isText && q.max_length ? parseInt(q.max_length) : undefined,
          validation_rule: isText && q.validation_rule ? q.validation_rule : undefined,
          min_label: q.question_type === "rating" && q.min_label ? q.min_label : undefined,
          max_label: q.question_type === "rating" && q.max_label ? q.max_label : undefined,
          order_index: q.order_index,
        });
        idMap[q.id] = created.id;
      }
      // 第二輪：套用顯示條件（將暫存題目 id 轉成真實 id）
      for (const q of questions) {
        if (q.rules.length === 0) continue;
        const rules = q.rules
          .filter(r => r.question_id && idMap[r.question_id])
          .map(r => ({ ...r, question_id: idMap[r.question_id] }));
        if (rules.length > 0) {
          await surveysApi.updateQuestion(idMap[q.id], { condition: { rules } });
        }
      }
      if (publish) await surveysApi.open(survey.id);
      clearDraft();
      toast.success(publish ? "問卷已建立並開放填答" : "問卷草稿已建立");
      router.push(`/surveys/${encodeURIComponent(survey.title)}`);
    } catch (e) {
      flushDraft();
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally { setSaving(false); }
  };

  const needsOptions = newQ.question_type === "single" || newQ.question_type === "multiple";
  const isRating = newQ.question_type === "rating";
  const isDisplay = isDisplayType(newQ.question_type);
  const isImage = newQ.question_type === "image";
  const isVideo = newQ.question_type === "video";
  const isTextInput = newQ.question_type === "text" || newQ.question_type === "textarea";
  const textLabel = isImage ? "圖片說明（選填）" : isDisplay ? "區塊內容 / 標題 *" : "題目文字 *";

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
            <div>
              <Label>所屬組織 *</Label>
              <select value={orgId} onChange={e => setOrgId(e.target.value)} className="input">
                <option value="">選擇組織…</option>
                {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            <ActivitySelect value={activityId} onChange={setActivityId} />
          </div>

          {/* 填答對象 */}
          <div className="card p-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              填答對象
            </h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)}
                className="accent-sky-400" />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                開放未登入者也可填答（公開問卷）
              </span>
            </label>
            {!isPublic && (
              <>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  需登入才能填答。下列限制全部留空＝任何登入者皆可；填寫後僅符合任一條件者可填。
                </p>
                <div>
                  <Label>限定 email 網域（一行一個，例：hchs.hc.edu.tw 即限本校）</Label>
                  <textarea value={allowedDomains} onChange={e => setAllowedDomains(e.target.value)}
                    rows={2} placeholder="hchs.hc.edu.tw" className="input resize-y" />
                </div>
                <div>
                  <Label>限定特定使用者</Label>
                  <UserPicker value={allowedUsers} onChange={setAllowedUsers} />
                </div>
                {orgs.length > 0 && (
                  <div>
                    <Label>限定組織成員</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {orgs.map(org => {
                        const on = allowedOrgIds.includes(org.id);
                        return (
                          <button key={org.id} type="button"
                            onClick={() => setAllowedOrgIds(prev =>
                              on ? prev.filter(x => x !== org.id) : [...prev, org.id])}
                            className="text-xs px-2.5 py-1 rounded-full"
                            style={on
                              ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                              : { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                            {org.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
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
                    className="px-5 py-3.5 space-y-2"
                    style={idx < questions.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                    <div className="flex items-start gap-3">
                      <span className="text-xs font-bold mt-0.5 w-5 flex-shrink-0" style={{ color: "var(--primary)" }}>
                        Q{idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                          {q.question_text || (q.question_type === "image" ? "（圖片區塊）" : "（未命名）")}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {QUESTION_TYPES.find(t => t.value === q.question_type)?.label}
                          {q.is_required && " · 必填"}
                          {q.options.length > 0 && ` · ${q.options.length} 個選項`}
                          {q.image_url && " · 含圖片"}
                          {q.rules.length > 0 && ` · ${q.rules.length} 條顯示條件`}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button type="button" onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}
                          className="topbar-icon-btn" aria-label="上移題目" style={{ opacity: idx === 0 ? 0.3 : 1 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>
                        </button>
                        <button type="button" onClick={() => moveQuestion(idx, 1)} disabled={idx === questions.length - 1}
                          className="topbar-icon-btn" aria-label="下移題目" style={{ opacity: idx === questions.length - 1 ? 0.3 : 1 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                        <button type="button" onClick={() => removeQuestion(q.id)}
                          className="topbar-icon-btn hover:text-red-400"
                          style={{ color: "var(--text-muted)" }} aria-label="刪除題目">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {questions.length > 1 && (
                      <details className="pl-1 sm:pl-8">
                        <summary className="text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
                          顯示條件{q.rules.length > 0 ? `（已設 ${q.rules.length} 條）` : "（選填）"}
                        </summary>
                        <div className="pt-2">
                          <ConditionEditor
                            rules={q.rules}
                            others={questions
                              .filter(o => o.id !== q.id)
                              .map(o => ({
                                id: o.id,
                                label: `Q${questions.findIndex(x => x.id === o.id) + 1}. ${
                                  (o.question_text || QUESTION_TYPES.find(t => t.value === o.question_type)?.label || "").slice(0, 24)
                                }`,
                                type: o.question_type,
                                options: o.options,
                              }))}
                            onChange={rules => setQuestionRules(q.id, rules)}
                          />
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 新增題目 */}
          <div className="card p-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>新增題目</h3>
            <div>
              <Label>{textLabel}</Label>
              <textarea
                value={newQ.question_text}
                onChange={e => setNewQ(p => ({ ...p, question_text: e.target.value }))}
                rows={2}
                placeholder={isImage ? "圖片下方的說明文字…" : isDisplay ? "請輸入要顯示給填答者的內容…" : "請輸入題目…"}
                className="input resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>題型</Label>
                <select value={newQ.question_type}
                  onChange={e => {
                    const question_type = e.target.value as QuestionType;
                    setNewQ(p => ({
                      ...p,
                      question_type,
                      is_required: isDisplayType(question_type) ? false : p.is_required,
                      options: [],
                    }));
                  }}
                  className="input">
                  {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 mt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!isDisplay && (newQ.is_required ?? true)}
                    disabled={isDisplay}
                    onChange={e => setNewQ(p => ({ ...p, is_required: e.target.checked }))}
                    className="accent-sky-400" />
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>必填</span>
                </label>
              </div>
            </div>

            {isVideo && (
              <div>
                <Label>影片 URL</Label>
                <input
                  value={newQ.placeholder ?? ""}
                  onChange={e => setNewQ(p => ({ ...p, placeholder: e.target.value }))}
                  placeholder="https://youtube.com/watch?v=..."
                  className="input"
                />
              </div>
            )}

            {isImage && (
              <ImageField
                label="圖片 *"
                value={newQ.image_url ?? ""}
                onChange={url => setNewQ(p => ({ ...p, image_url: url }))}
                hint="從本地上傳，將單獨顯示為一個圖片區塊。"
              />
            )}

            {!isDisplay && (
              <ImageField
                label="附加圖片（選填）"
                value={newQ.image_url ?? ""}
                onChange={url => setNewQ(p => ({ ...p, image_url: url }))}
                hint="上傳後圖片會與此題合併顯示在題目上方。"
              />
            )}

            {/* 評分範圍與端點敘述 */}
            {isRating && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>起始分數（1–3）</Label>
                    <input type="number" min={1} max={3} value={newQ.min_value}
                      onChange={e => setNewQ(p => ({ ...p, min_value: parseInt(e.target.value) || 1 }))}
                      className="input" />
                  </div>
                  <div>
                    <Label>最大分數（1–100）</Label>
                    <input type="number" min={1} max={100} value={newQ.max_value}
                      onChange={e => setNewQ(p => ({ ...p, max_value: parseInt(e.target.value) || 5 }))}
                      className="input" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>最低分敘述（選填）</Label>
                    <input value={newQ.min_label ?? ""}
                      onChange={e => setNewQ(p => ({ ...p, min_label: e.target.value }))}
                      placeholder="例：非常不滿意" className="input" />
                  </div>
                  <div>
                    <Label>最高分敘述（選填）</Label>
                    <input value={newQ.max_label ?? ""}
                      onChange={e => setNewQ(p => ({ ...p, max_label: e.target.value }))}
                      placeholder="例：非常滿意" className="input" />
                  </div>
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

            {/* 自訂驗證規則（簡答 / 長答題型） */}
            {isTextInput && (
              <div className="space-y-3 rounded-xl p-3" style={{ background: "var(--bg-elevated)" }}>
                <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  自訂驗證規則（選填）
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>最少字數</Label>
                    <input type="number" min={0} value={newQ.min_length ?? ""}
                      onChange={e => setNewQ(p => ({ ...p, min_length: e.target.value }))}
                      placeholder="不限" className="input" />
                  </div>
                  <div>
                    <Label>最多字數</Label>
                    <input type="number" min={1} value={newQ.max_length ?? ""}
                      onChange={e => setNewQ(p => ({ ...p, max_length: e.target.value }))}
                      placeholder="不限" className="input" />
                  </div>
                </div>
                <div>
                  <Label>格式限制</Label>
                  <select value={newQ.validation_rule ?? ""}
                    onChange={e => setNewQ(p => ({ ...p, validation_rule: e.target.value }))}
                    className="input">
                    {VALIDATION_RULES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
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
            <button onClick={() => save(true)} disabled={saving} className="btn btn-primary w-full" aria-busy={saving}>
              {saving ? "處理中…" : "建立並發布"}
            </button>
            <button onClick={() => save(false)} disabled={saving} className="btn btn-ghost w-full" aria-busy={saving}>
              {saving ? "處理中…" : "儲存草稿"}
            </button>
            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              「建立並發布」立即開放填答；「儲存草稿」可稍後再開放
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
