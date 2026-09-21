"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { surveysApi, orgsApi, apiErrorMessage } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import type { QuestionType, ValidationRule, UserSummary } from "@/lib/types";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import UserPicker from "@/components/surveys/UserPicker";
import ActivitySelect from "@/components/activities/ActivitySelect";
import GuidedForm, { GuidedFormStep, type GuidedFormStepDefinition } from "@/components/ui/GuidedForm";
import OptionImageFields from "@/components/surveys/OptionImageFields";
import SurveyImageField from "@/components/surveys/SurveyImageField";
import {
  GovernanceLinkNotice,
  createGovernanceBacklink,
  governanceContextFromParams,
} from "@/lib/governanceLinking";

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

const SURVEY_STEPS: GuidedFormStepDefinition[] = [
  { label: "基本資料", description: "說明這份問卷要蒐集什麼。" },
  { label: "填答對象", description: "決定誰能看到與填寫問卷。" },
  { label: "設計題目", description: "逐題加入內容，進階規則可稍後再調整。" },
  { label: "確認發布", description: "檢查設定後儲存草稿或直接開放填答。" },
];

type CondRule = { question_id: string; operator: string; value: string; connector: string };

interface DraftQuestion {
  id: string;
  question_text: string;
  question_type: QuestionType;
  is_required: boolean;
  options: string[];
  option_image_sets: string[][];
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
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
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
  const searchParams = useSearchParams();
  const governanceContext = useMemo(
    () => governanceContextFromParams(searchParams),
    [searchParams],
  );
  const [saving, setSaving] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // 問卷基本資料
  const [title, setTitle] = useState(governanceContext?.matterTitle ?? "");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState("");
  const [orgId, setOrgId] = useState(governanceContext?.orgId ?? "");
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
    question_text: "", question_type: "text", is_required: true, options: [], option_image_sets: [], min_value: 1, max_value: 5,
    placeholder: "", image_url: "", min_length: "", max_length: "", validation_rule: "", min_label: "", max_label: "",
  });
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);

  useEffect(() => {
    const storedOrgId = localStorage.getItem("org_id") ?? "";
    orgsApi.list({ active_only: true })
      .then((items) => {
        const usableStoredOrgId = items.some((org) => org.id === storedOrgId) ? storedOrgId : "";
        setOrgs(items);
        setOrgId((current) => {
          if (current && items.some((org) => org.id === current)) return current;
          return usableStoredOrgId || (items.length === 1 ? items[0].id : "");
        });
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
  }), [
    activityId,
    allowMultiple,
    closesAt,
    description,
    isAnonymous,
    newQ,
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
    setQuestions((draft.questions ?? []).map(q => ({
      ...q,
      option_image_sets: q.option_image_sets ?? [],
      rules: q.rules ?? [],
    })));
    setNewQ(draft.newQ ?? {
      question_text: "",
      question_type: "text",
      is_required: true,
      options: [],
      option_image_sets: [],
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
    toast.info("已復原未送出的問卷草稿");
  }, []);
  const { clearDraft, flushDraft, lastSavedAt } = useDraftAutosave({
    key: "surveys:new",
    value: draftValue,
    onRestore: restoreDraft,
    isEmpty: useCallback((draft: SurveyDraft) => (
      !(draft.title ?? "").trim()
      && !(draft.description ?? "").trim()
      && !draft.closesAt
      && (draft.questions ?? []).length === 0
      && !(draft.newQ.question_text ?? "").trim()
      && !(draft.newQ.options ?? []).some((option) => option.trim())
      && !(draft.newQ.option_image_sets ?? []).some((images) => images.length > 0)
    ), []),
  });

  const addQuestion = () => {
    const qType = newQ.question_type ?? "text";
    const isImg = qType === "image";
    if (isImg && !newQ.image_url) { toast.error("圖片題型請先上傳圖片"); return; }
    if (!isImg && !newQ.question_text?.trim()) { toast.error("請輸入題目或區塊文字"); return; }
    const needsOptions = qType === "single" || qType === "multiple";
    const optionEntries = (newQ.options ?? []).map((option, index) => ({
      option: option.trim(),
      images: newQ.option_image_sets?.[index] ?? [],
    })).filter(({ option }) => Boolean(option));
    if (needsOptions && optionEntries.length < 2) {
      toast.error("選擇題至少需要 2 個選項"); return;
    }
    if (qType === "multiple" && (newQ.max_value ?? 0) > optionEntries.length) {
      toast.error("多選最多項數不可大於選項總數"); return;
    }
    const isText = qType === "text" || qType === "textarea";
    setQuestions(prev => {
      const draftQuestion: Omit<DraftQuestion, "id" | "order_index"> = {
        question_text: newQ.question_text?.trim() ?? "",
        question_type: qType,
        is_required: isDisplayType(qType) ? false : (newQ.is_required ?? true),
        options: optionEntries.map(({ option }) => option),
        option_image_sets: optionEntries.map(({ images }) => images),
        min_value: newQ.min_value ?? 1,
        max_value: qType === "multiple" ? (newQ.max_value ?? 0) : (newQ.max_value ?? 5),
        placeholder: newQ.placeholder ?? "",
        image_url: newQ.image_url ?? "",
        min_length: isText ? (newQ.min_length ?? "") : "",
        max_length: isText ? (newQ.max_length ?? "") : "",
        validation_rule: isText ? (newQ.validation_rule ?? "") : "",
        min_label: qType === "rating" ? (newQ.min_label ?? "") : "",
        max_label: qType === "rating" ? (newQ.max_label ?? "") : "",
        rules: [],
      };
      if (editingQuestionId) {
        return prev.map((question) => question.id === editingQuestionId
          ? { ...draftQuestion, id: question.id, order_index: question.order_index }
          : question);
      }
      return [...prev, { ...draftQuestion, id: crypto.randomUUID(), order_index: prev.length }];
    });
    // 保留上一題的題型與必填設定，方便連續新增同類型題目
    setNewQ({
      question_text: "",
      question_type: qType,
      is_required: newQ.is_required ?? true,
      options: [],
      option_image_sets: [],
      min_value: newQ.min_value ?? 1,
      max_value: qType === "multiple" ? (newQ.max_value ?? 0) : (newQ.max_value ?? 5),
      placeholder: "",
      image_url: "",
      min_length: "",
      max_length: "",
      validation_rule: "",
      min_label: "",
      max_label: "",
    });
    setEditingQuestionId(null);
  };

  const removeQuestion = (id: string) => {
    if (id === editingQuestionId) setEditingQuestionId(null);
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const editQuestion = (question: DraftQuestion) => {
    setNewQ({
      ...question,
      options: [...question.options],
      option_image_sets: question.option_image_sets.map((images) => [...images]),
      rules: question.rules.map((rule) => ({ ...rule })),
    });
    setEditingQuestionId(question.id);
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

  const reorderQuestion = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setQuestions((previous) => {
      const sourceIndex = previous.findIndex((question) => question.id === sourceId);
      const targetIndex = previous.findIndex((question) => question.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return previous;
      const next = [...previous];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next.map((question, index) => ({ ...question, order_index: index }));
    });
  };

  const setQuestionRules = (id: string, rules: CondRule[]) => {
    setQuestions(prev => prev.map(q => (q.id === id ? { ...q, rules } : q)));
    if (id === editingQuestionId) setNewQ((question) => ({ ...question, rules }));
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
          option_image_sets: q.option_image_sets,
          min_value: q.question_type === "rating" ? q.min_value : undefined,
          max_value: q.question_type === "rating"
            ? q.max_value
            : q.question_type === "multiple" && q.max_value > 0
              ? q.max_value
              : undefined,
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
      await createGovernanceBacklink({
        context: governanceContext,
        targetType: "survey",
        targetId: survey.id,
        title: survey.title,
        href: `/surveys/${survey.id}`,
      });
      clearDraft();
      toast.success(publish ? "問卷已建立並開放填答" : "問卷草稿已建立");
      router.push(`/surveys/${encodeURIComponent(survey.title)}`);
    } catch (e) {
      flushDraft();
      toast.error(apiErrorMessage(e, "建立失敗"));
    } finally { setSaving(false); }
  };

  const advanceStep = () => {
    if (activeStep === 0 && (!title.trim() || !orgId)) {
      toast.error(!title.trim() ? "請先輸入問卷標題" : "請先選擇所屬組織");
      return;
    }
    if (activeStep === 2 && !questions.some((question) => !isDisplayType(question.question_type))) {
      toast.error("請至少新增一道可填答題目");
      return;
    }
    setActiveStep((step) => Math.min(step + 1, SURVEY_STEPS.length - 1));
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

      <GovernanceLinkNotice context={governanceContext} />

      <GuidedForm
        steps={SURVEY_STEPS}
        activeStep={activeStep}
        onStepChange={setActiveStep}
        onBack={() => setActiveStep((step) => Math.max(step - 1, 0))}
        onNext={advanceStep}
        onSave={() => save(true)}
        secondarySaveAction={{ label: "儲存草稿", onClick: () => save(false) }}
        saveLabel="建立並發布"
        saving={saving}
        draftStatus={lastSavedAt
          ? `已於 ${new Date(lastSavedAt).toLocaleTimeString("zh-TW", {
            hour: "2-digit", minute: "2-digit",
          })} 自動保存`
          : "變更會自動保存到此裝置"}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 主欄 */}
        <div className="lg:col-span-2 space-y-4">

          <GuidedFormStep step={0} activeStep={activeStep}>
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
          </GuidedFormStep>

          <GuidedFormStep step={1} activeStep={activeStep}>
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
          </GuidedFormStep>

          <GuidedFormStep step={2} activeStep={activeStep} className="space-y-4">
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
                    draggable
                    onDragStart={() => setDraggedQuestionId(q.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedQuestionId) reorderQuestion(draggedQuestionId, q.id);
                      setDraggedQuestionId(null);
                    }}
                    onDragEnd={() => setDraggedQuestionId(null)}
                    style={{
                      ...(idx < questions.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}),
                      ...(editingQuestionId === q.id ? { background: "var(--primary-dim)" } : {}),
                    }}>
                    <div className="flex items-start gap-3">
                      <span className="cursor-grab mt-0.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} title="拖曳調整順序">
                        <GripVertical size={16} aria-hidden="true" />
                      </span>
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
                          {q.question_type === "multiple" && q.max_value > 0
                            && ` · 最多選 ${q.max_value} 項`}
                          {q.image_url && " · 含圖片"}
                          {q.rules.length > 0 && ` · ${q.rules.length} 條顯示條件`}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button type="button" onClick={() => editQuestion(q)}
                          className="btn btn-ghost min-h-11 px-2 text-xs" aria-label={`編輯第 ${idx + 1} 題`}>
                          編輯
                        </button>
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
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {editingQuestionId ? "編輯題目" : "新增題目"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
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
                      option_image_sets: [],
                      max_value: question_type === "multiple" ? 0 : p.max_value,
                    }));
                  }}
                  className="input">
                  {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {!isDisplay && (
              <label className="flex min-h-11 items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newQ.is_required ?? true}
                  onChange={e => setNewQ(p => ({ ...p, is_required: e.target.checked }))}
                  className="accent-sky-400" />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>必填</span>
              </label>
            )}

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
              <SurveyImageField
                label="圖片 *"
                value={newQ.image_url ?? ""}
                onChange={url => setNewQ(p => ({ ...p, image_url: url }))}
                hint="從本地上傳，將單獨顯示為一個圖片區塊。"
              />
            )}

            {!isDisplay && (
              <SurveyImageField
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
              <OptionImageFields
                options={newQ.options ?? []}
                value={newQ.option_image_sets ?? []}
                onChange={option_image_sets => setNewQ(p => ({ ...p, option_image_sets }))}
                onOptionsChange={options => setNewQ(p => ({ ...p, options }))}
                selectionStyle={newQ.question_type === "multiple" ? "multiple" : "single"}
              />
            )}

            {newQ.question_type === "multiple" && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--bg-elevated)" }}>
                <div>
                  <Label>最多可選項數（選填）</Label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, (newQ.options ?? []).filter(option => option.trim()).length)}
                    value={newQ.max_value || ""}
                    onChange={event => setNewQ(question => ({
                      ...question,
                      max_value: parseInt(event.target.value) || 0,
                    }))}
                    placeholder="不限制"
                    className="input"
                  />
                </div>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  留空代表不限制；設定後填答者會看到「最多可選 N 項」提示。
                </p>
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

            <button onClick={addQuestion} className="btn btn-primary w-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {editingQuestionId ? "儲存題目變更" : "加入此題目"}
            </button>
          </div>
          </GuidedFormStep>
        </div>

        {/* 右欄：儲存 */}
        <GuidedFormStep step={3} activeStep={activeStep} className="space-y-4">
          <div className="card p-4 space-y-3 hidden md:block">
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
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>發布前確認</h3>
            <div className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              <p>{questions.length} 道題目</p>
              <p>{isAnonymous ? "匿名填答" : "記名填答"}</p>
              <p>{allowMultiple ? "允許重複填答" : "每人限填一次"}</p>
              {closesAt && <p>截止：{new Date(closesAt).toLocaleString("zh-TW")}</p>}
            </div>
          </div>
        </GuidedFormStep>
      </div>
      </GuidedForm>
    </div>
  );
}
