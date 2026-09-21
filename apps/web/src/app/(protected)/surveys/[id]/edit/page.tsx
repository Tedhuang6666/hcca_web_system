"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { GripVertical, Loader2 } from "lucide-react";
import { activitiesApi, surveysApi, orgsApi, usersApi, apiErrorMessage } from "@/lib/api";
import type { SurveyQuestionBody, OrgRead } from "@/lib/api";
import type { Activity, SurveyOut, SurveyQuestionOut, QuestionType, UserSummary } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import UserPicker from "@/components/surveys/UserPicker";
import ActivitySelect from "@/components/activities/ActivitySelect";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";
import OptionImageFields from "@/components/surveys/OptionImageFields";
import SurveyImageField from "@/components/surveys/SurveyImageField";

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "text", label: "簡答（單行）" },
  { value: "textarea", label: "長答（多行）" },
  { value: "single", label: "單選" },
  { value: "multiple", label: "多選" },
  { value: "ranking", label: "拖拉排序" },
  { value: "rating", label: "評分" },
  { value: "date", label: "日期" },
  { value: "section_text", label: "文字描述區塊" },
  { value: "page_break", label: "分頁" },
  { value: "image", label: "圖片" },
  { value: "video", label: "影片連結" },
];

const VALIDATION_RULES = [
  { value: "", label: "不限格式" },
  { value: "email", label: "電子郵件" },
  { value: "number", label: "數字" },
  { value: "integer", label: "整數" },
  { value: "url", label: "網址" },
  { value: "phone", label: "電話號碼" },
];

const DISPLAY_TYPES = new Set<QuestionType>(["section_text", "page_break", "image", "video"]);
const typeLabel = (t: QuestionType) => QUESTION_TYPES.find(x => x.value === t)?.label ?? t;

type CondRule = { question_id: string; operator: string; value: string; connector: string };

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

/* ── 單題編輯卡 ───────────────────────────────────────────────────────────── */
function QuestionRow({
  q, index, total, others, busy, onSave, onDelete, onMove, isActive, onActivate, onDragStart, onDragEnd, onDrop,
}: {
  q: SurveyQuestionOut;
  index: number;
  total: number;
  others: SurveyQuestionOut[];
  busy: boolean;
  onSave: (id: string, body: SurveyQuestionBody) => Promise<void>;
  onDelete: (id: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  isActive: boolean;
  onActivate: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [text, setText] = useState(q.question_text);
  const [questionType, setQuestionType] = useState<QuestionType>(q.question_type);
  const [required, setRequired] = useState(q.is_required);
  const [options, setOptions] = useState<string[]>(q.options ?? []);
  const [minValue, setMinValue] = useState(q.min_value ?? 1);
  const [maxValue, setMaxValue] = useState(q.max_value ?? 5);
  const [maxSelections, setMaxSelections] = useState(
    q.question_type === "multiple" ? (q.max_value ?? 0) : 0,
  );
  const [minLabel, setMinLabel] = useState(q.min_label ?? "");
  const [maxLabel, setMaxLabel] = useState(q.max_label ?? "");
  const [minLength, setMinLength] = useState(q.min_length?.toString() ?? "");
  const [maxLength, setMaxLength] = useState(q.max_length?.toString() ?? "");
  const [rule, setRule] = useState<string>(q.validation_rule ?? "");
  const [placeholder, setPlaceholder] = useState(q.placeholder ?? "");
  const [imageUrl, setImageUrl] = useState(q.image_url ?? "");
  const [optionImageSets, setOptionImageSets] = useState<string[][]>(q.option_image_sets ?? []);
  const [exclusiveOpts, setExclusiveOpts] = useState<string[]>(q.option_config?.exclusive ?? []);
  const [otherOpts, setOtherOpts] = useState<string[]>(q.option_config?.other ?? []);
  const [rules, setRules] = useState<CondRule[]>(
    (q.condition?.rules ?? []).map(r => ({
      question_id: r.question_id, operator: r.operator, value: r.value, connector: r.connector,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const hasInitializedDraft = useRef(false);
  const lastSavedFingerprint = useRef("");
  const failedFingerprint = useRef("");

  const updateRule = (i: number, patch: Partial<CondRule>) =>
    setRules(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRule = () =>
    setRules(rs => [...rs, { question_id: "", operator: "equals", value: "", connector: "and" }]);
  const removeRule = (i: number) => setRules(rs => rs.filter((_, idx) => idx !== i));
  const moveRule = (i: number, dir: -1 | 1) =>
    setRules(rs => {
      const t = i + dir;
      if (t < 0 || t >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[t]] = [next[t], next[i]];
      return next;
    });
  const isMultiple = questionType === "multiple";
  const isRanking = questionType === "ranking";
  const isChoice = questionType === "single" || isMultiple || isRanking;
  const isRating = questionType === "rating";
  const isText = questionType === "text" || questionType === "textarea";
  const isImage = questionType === "image";
  const isVideo = questionType === "video";

  const optionEntries = options.map((option, index) => ({
    option: option.trim(),
    images: optionImageSets[index] ?? [],
  })).filter(({ option }) => Boolean(option));
  const parsedOptions = optionEntries.map(({ option }) => option);
  const draftFingerprint = useMemo(() => JSON.stringify({
    text,
    questionType,
    required,
    options,
    minValue,
    maxValue,
    maxSelections,
    minLabel,
    maxLabel,
    minLength,
    maxLength,
    rule,
    placeholder,
    imageUrl,
    optionImageSets,
    exclusiveOpts,
    otherOpts,
    rules,
  }), [
    text,
    questionType,
    required,
    options,
    minValue,
    maxValue,
    maxSelections,
    minLabel,
    maxLabel,
    minLength,
    maxLength,
    rule,
    placeholder,
    imageUrl,
    optionImageSets,
    exclusiveOpts,
    otherOpts,
    rules,
  ]);
  const toggleExclusive = (opt: string) =>
    setExclusiveOpts(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);
  const toggleOther = (opt: string) =>
    setOtherOpts(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);

  const save = async (manual = false) => {
    if (saving || busy) return;
    const opts = isChoice ? parsedOptions : [];
    let validationError = "";
    if (isChoice && opts.length < 2) validationError = "選擇題至少需 2 個選項";
    if (isRanking && maxValue > opts.length) {
      validationError = "排序最多項數不可大於選項總數";
    }
    if (isRanking && minValue > maxValue) {
      validationError = "最少項數不可大於最多項數";
    }
    if (isMultiple && maxSelections > opts.length) {
      validationError = "多選最多項數不可大於選項總數";
    }
    if (validationError) {
      setSaveStatus("error");
      setSaveError(validationError);
      if (manual) toast.error(validationError);
      return;
    }
    setSaving(true);
    setSaveStatus("saving");
    setSaveError("");
    const body: SurveyQuestionBody = {
      question_text: text,
      question_type: questionType,
      is_required: DISPLAY_TYPES.has(questionType) ? false : required,
    };
    if (isChoice) {
      body.options = opts;
      body.option_image_sets = optionEntries.map(({ images }) => images);
    } else {
      body.options = [];
      body.option_image_sets = [];
    }
    if (isMultiple) {
      const exclusive = exclusiveOpts.filter(o => opts.includes(o));
      const other = otherOpts.filter(o => opts.includes(o));
      body.option_config = (exclusive.length || other.length) ? { exclusive, other } : null;
      body.max_value = maxSelections || null;
    }
    if (isRanking) {
      body.min_value = Math.max(1, minValue);
      body.max_value = Math.min(opts.length, maxValue);
    }
    if (isRating) {
      body.min_value = minValue;
      body.max_value = maxValue;
      body.min_label = minLabel;
      body.max_label = maxLabel;
    }
    if (isText) {
      body.min_length = minLength ? parseInt(minLength) : undefined;
      body.max_length = maxLength ? parseInt(maxLength) : undefined;
      body.validation_rule = rule || undefined;
    }
    if (isVideo) body.placeholder = placeholder;
    if (isImage || (!DISPLAY_TYPES.has(questionType))) body.image_url = imageUrl;
    const validRules = rules.filter(r => r.question_id);
    body.condition = validRules.length ? { rules: validRules } : null;
    try {
      await onSave(q.id, body);
      lastSavedFingerprint.current = draftFingerprint;
      failedFingerprint.current = "";
      setSaveStatus("saved");
    } catch (error) {
      failedFingerprint.current = draftFingerprint;
      setSaveStatus("error");
      setSaveError(apiErrorMessage(error, "無法自動儲存，請稍後重試。"));
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!hasInitializedDraft.current) {
      hasInitializedDraft.current = true;
      lastSavedFingerprint.current = draftFingerprint;
      return;
    }
    if (
      busy
      || saving
      || draftFingerprint === lastSavedFingerprint.current
      || draftFingerprint === failedFingerprint.current
    ) return;
    setSaveStatus("pending");
    const timeout = window.setTimeout(() => { void saveRef.current(false); }, 700);
    return () => window.clearTimeout(timeout);
  }, [busy, draftFingerprint, saving]);

  return (
    <div
      className="card p-4 space-y-3"
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2">
        <span className="cursor-grab shrink-0" style={{ color: "var(--text-muted)" }} title="拖曳調整順序">
          <GripVertical size={17} aria-hidden="true" />
        </span>
        <button
          type="button"
          onClick={onActivate}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={isActive}
          aria-label={`編輯第 ${index + 1} 題`}
        >
          <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded"
            style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
            第 {index + 1} 題
          </span>
          <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
            {q.question_text || typeLabel(questionType)}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0 || busy}
            className="topbar-icon-btn" aria-label="上移" style={{ opacity: index === 0 ? 0.3 : 1 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={index === total - 1 || busy}
            className="topbar-icon-btn" aria-label="下移" style={{ opacity: index === total - 1 ? 0.3 : 1 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          <button type="button" onClick={() => onDelete(q.id)} disabled={busy}
            className="topbar-icon-btn" aria-label="刪除題目" style={{ color: "var(--danger)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {isActive && <>
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
        style={{ background: "var(--bg-elevated)" }}
        role="status"
        aria-live="polite"
      >
        <span style={{ color: saveStatus === "error" ? "var(--danger)" : "var(--text-secondary)" }}>
          {saveStatus === "saving" && "正在自動儲存…"}
          {saveStatus === "pending" && "已修改，稍後會自動儲存"}
          {saveStatus === "saved" && "修改會自動儲存"}
          {saveStatus === "error" && `尚未儲存：${saveError}`}
        </span>
        <span style={{ color: "var(--text-muted)" }}>停止輸入約 1 秒後即會儲存</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div>
          <Label>{isImage ? "圖片說明（選填）" : DISPLAY_TYPES.has(questionType) ? "區塊文字" : "題目文字"}</Label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            className="input resize-y" />
        </div>
        <div>
          <Label>題型</Label>
          <select value={questionType} onChange={event => setQuestionType(event.target.value as QuestionType)} className="input">
            {QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
      </div>

      {!DISPLAY_TYPES.has(questionType) && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)}
            className="accent-sky-400" />
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>必填</span>
        </label>
      )}

      {isChoice && (
        <OptionImageFields
          options={options}
          value={optionImageSets}
          onChange={setOptionImageSets}
          onOptionsChange={setOptions}
          selectionStyle={isMultiple ? "multiple" : isRanking ? "ranking" : "single"}
        />
      )}

      {isMultiple && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--bg-elevated)" }}>
          <div>
            <Label>最多可選項數（選填）</Label>
            <input
              type="number"
              min={1}
              max={Math.max(1, parsedOptions.length)}
              value={maxSelections || ""}
              onChange={event => setMaxSelections(parseInt(event.target.value) || 0)}
              placeholder="不限制"
              className="input"
            />
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            留空代表不限制；設定後填答者會看到「最多可選 N 項」提示。
          </p>
        </div>
      )}

      {isMultiple && parsedOptions.length > 0 && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--bg-elevated)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            選項額外設定（選填）
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            <strong>互斥</strong>：勾選此項時自動清空其他項目（如「以上皆非」）。
            <br />
            <strong>其他</strong>：勾選此項時顯示文字輸入框，可由填答者自由輸入。
          </p>
          <div className="space-y-1">
            {parsedOptions.map(opt => (
              <div key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{ background: "var(--bg-surface)" }}>
                <span className="text-sm flex-1 truncate" style={{ color: "var(--text-primary)" }}>{opt}</span>
                <label className="flex items-center gap-1 text-xs cursor-pointer"
                  style={{ color: "var(--text-muted)" }}>
                  <input type="checkbox" checked={exclusiveOpts.includes(opt)}
                    onChange={() => toggleExclusive(opt)} className="accent-sky-400" />
                  互斥
                </label>
                <label className="flex items-center gap-1 text-xs cursor-pointer"
                  style={{ color: "var(--text-muted)" }}>
                  <input type="checkbox" checked={otherOpts.includes(opt)}
                    onChange={() => toggleOther(opt)} className="accent-sky-400" />
                  其他
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {isRanking && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>最少排序項數</Label>
            <input type="number" min={1} max={Math.max(1, parsedOptions.length)} value={minValue}
              onChange={e => setMinValue(parseInt(e.target.value) || 1)} className="input" />
          </div>
          <div>
            <Label>最多排序項數</Label>
            <input type="number" min={1} max={Math.max(1, parsedOptions.length)} value={maxValue}
              onChange={e => setMaxValue(parseInt(e.target.value) || 1)} className="input" />
          </div>
          <p className="col-span-2 text-xs" style={{ color: "var(--text-muted)" }}>
            填答者需從上述選項中挑選並排序（最少 {Math.max(1, minValue)}、最多 {Math.min(parsedOptions.length || maxValue, maxValue)} 項）。
          </p>
        </div>
      )}

      {isRating && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>起始分數（1–3）</Label>
            <input type="number" min={1} max={3} value={minValue}
              onChange={e => setMinValue(parseInt(e.target.value) || 1)} className="input" />
          </div>
          <div>
            <Label>最大分數（1–100）</Label>
            <input type="number" min={1} max={100} value={maxValue}
              onChange={e => setMaxValue(parseInt(e.target.value) || 5)} className="input" />
          </div>
          <div>
            <Label>最低分敘述</Label>
            <input value={minLabel} onChange={e => setMinLabel(e.target.value)}
              placeholder="例：非常不滿意" className="input" />
          </div>
          <div>
            <Label>最高分敘述</Label>
            <input value={maxLabel} onChange={e => setMaxLabel(e.target.value)}
              placeholder="例：非常滿意" className="input" />
          </div>
        </div>
      )}

      {isText && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>最少字數</Label>
            <input type="number" min={0} value={minLength}
              onChange={e => setMinLength(e.target.value)} placeholder="不限" className="input" />
          </div>
          <div>
            <Label>最多字數</Label>
            <input type="number" min={1} value={maxLength}
              onChange={e => setMaxLength(e.target.value)} placeholder="不限" className="input" />
          </div>
          <div>
            <Label>格式</Label>
            <select value={rule} onChange={e => setRule(e.target.value)} className="input">
              {VALIDATION_RULES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {isVideo && (
        <div>
          <Label>影片 URL</Label>
          <input value={placeholder} onChange={e => setPlaceholder(e.target.value)}
            placeholder="https://youtube.com/watch?v=..." className="input" />
        </div>
      )}

      {(isImage || !DISPLAY_TYPES.has(questionType)) && (
        <SurveyImageField
          label={isImage ? "圖片" : "附加圖片（選填）"}
          value={imageUrl}
          onChange={setImageUrl}
          hint="上傳後會自動儲存並套用到填答表單。"
        />
      )}

      {/* 顯示條件 */}
      <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--bg-elevated)" }}>
        <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          顯示條件（選填，由上到下依序判斷）
        </p>
        {rules.length === 0 && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>無條件，一律顯示此題。</p>
        )}
        {rules.map((r, i) => (
          <div key={i} className="space-y-1.5 rounded-lg p-2" style={{ background: "var(--bg-surface)" }}>
            {i > 0 && (
              <div className="flex gap-1">
                {(["and", "or"] as const).map(c => (
                  <button key={c} type="button" onClick={() => updateRule(i, { connector: c })}
                    className="text-xs px-2 py-0.5 rounded"
                    style={r.connector === c
                      ? { background: "var(--primary)", color: "var(--primary-fg)" }
                      : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                    {c === "and" ? "且" : "或"}
                  </button>
                ))}
              </div>
            )}
            <select value={r.question_id} onChange={e => updateRule(i, { question_id: e.target.value })}
              className="input text-sm">
              <option value="">選擇來源題目…</option>
              {others.map(o => (
                <option key={o.id} value={o.id}>
                  {(o.question_text || typeLabel(o.question_type)).slice(0, 28)}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1.5 items-center">
              <select value={r.operator} onChange={e => updateRule(i, { operator: e.target.value })}
                className="input text-sm" style={{ flex: "1 1 6rem" }}>
                <option value="equals">完全等於</option>
                <option value="contains">包含</option>
              </select>
              {(() => {
                const src = others.find(o => o.id === r.question_id);
                const choices = src && (src.question_type === "single" || src.question_type === "multiple")
                  ? (src.options ?? []) : [];
                return choices.length > 0 ? (
                  <select value={r.value} onChange={e => updateRule(i, { value: e.target.value })}
                    className="input text-sm" style={{ flex: "2 1 8rem" }}>
                    <option value="">選擇答案…</option>
                    {choices.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <input value={r.value} onChange={e => updateRule(i, { value: e.target.value })}
                    placeholder="答案文字" className="input text-sm" style={{ flex: "2 1 8rem" }} />
                );
              })()}
              <div className="flex gap-1 ml-auto">
                <button type="button" onClick={() => moveRule(i, -1)} disabled={i === 0}
                  className="topbar-icon-btn" aria-label="上移條件" style={{ opacity: i === 0 ? 0.3 : 1 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="3" strokeLinecap="round" aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>
                </button>
                <button type="button" onClick={() => moveRule(i, 1)} disabled={i === rules.length - 1}
                  className="topbar-icon-btn" aria-label="下移條件" style={{ opacity: i === rules.length - 1 ? 0.3 : 1 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="3" strokeLinecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                <button type="button" onClick={() => removeRule(i)} className="topbar-icon-btn"
                  aria-label="刪除條件" style={{ color: "var(--danger)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={addRule} className="btn btn-ghost w-full text-xs">
          ＋ 新增條件
        </button>
      </div>

      <button type="button" onClick={() => { void save(true); }} disabled={saving || busy}
        className="btn btn-ghost w-full text-sm" aria-busy={saving}>
        {saving ? "儲存中…" : "立即儲存"}
      </button>
      </>}
    </div>
  );
}

/* ── 主頁面 ───────────────────────────────────────────────────────────────── */
export default function EditSurveyPage() {
  const params = useParams();
  const id = params.id as string;
  const { can } = usePermissions();

  const [survey, setSurvey] = useState<SurveyOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [activityId, setActivityId] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [newType, setNewType] = useState<QuestionType>("text");
  const [newText, setNewText] = useState("");
  const [newRequired, setNewRequired] = useState(true);
  const [newOptions, setNewOptions] = useState<string[]>([]);
  const [newOptionImageSets, setNewOptionImageSets] = useState<string[][]>([]);
  const [newImageUrl, setNewImageUrl] = useState("");
  // 開放對象
  const [isPublic, setIsPublic] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState("");
  const [allowedUsers, setAllowedUsers] = useState<UserSummary[]>([]);
  const [allowedOrgIds, setAllowedOrgIds] = useState<string[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);

  useEffect(() => {
    orgsApi.list({ active_only: true }).then(setOrgs).catch(() => setOrgs([]));
    activitiesApi.mine(true).then(setActivities).catch(() => setActivities([]));
  }, []);

  const load = useCallback(() => {
    surveysApi.get(id)
      .then(s => {
        setSurvey(s);
        setTitle(s.title);
        setDescription(s.description ?? "");
        setClosesAt(s.closes_at ? s.closes_at.slice(0, 16) : "");
        setActivityId(s.activity_id ?? "");
        setIsPublic(s.is_public);
        setAllowedDomains((s.allowed_domains ?? []).join("\n"));
        setAllowedOrgIds(s.allowed_org_ids ?? []);
        if ((s.allowed_user_ids?.length ?? 0) > 0) {
          usersApi.listByIds(s.allowed_user_ids ?? [])
            .then(setAllowedUsers)
            .catch(() => setAllowedUsers([]));
        } else {
          setAllowedUsers([]);
        }
      })
      .catch(() => toast.error("載入問卷失敗"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveMeta = async () => {
    if (!survey) return;
    if (!title.trim()) { toast.error("請輸入標題"); return; }
    setBusy(true);
    try {
      await surveysApi.update(survey.id, {
        title: title.trim(),
        description: description.trim(),
        closes_at: closesAt || undefined,
        activity_id: activityId || null,
        is_public: isPublic,
        allowed_org_ids: isPublic ? [] : allowedOrgIds,
        allowed_user_ids: isPublic ? [] : allowedUsers.map(u => u.id),
        allowed_domains: isPublic
          ? []
          : allowedDomains.split("\n").map(s => s.trim()).filter(Boolean),
      });
      toast.success("基本資料已更新");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    } finally { setBusy(false); }
  };

  const saveQuestion = useCallback(async (questionId: string, body: SurveyQuestionBody) => {
    const updated = await surveysApi.updateQuestion(questionId, body);
    setSurvey(current => current
      ? {
        ...current,
        questions: current.questions.map(question => (
          question.id === updated.id ? updated : question
        )),
      }
      : current);
  }, []);

  const deleteQuestion = async (questionId: string) => {
    if (!confirm("確定刪除此題？該題已有的回答也會一併移除。")) return;
    setBusy(true);
    try {
      await surveysApi.deleteQuestion(questionId);
      if (activeQuestionId === questionId) setActiveQuestionId(null);
      toast.success("題目已刪除");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    } finally { setBusy(false); }
  };

  const reorder = async (sourceIndex: number, targetIndex: number) => {
    if (!survey) return;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= survey.questions.length || sourceIndex === targetIndex) return;
    const ordered = [...survey.questions];
    const [moved] = ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, moved);
    setBusy(true);
    try {
      for (let i = 0; i < ordered.length; i += 1) {
        if (ordered[i].order_index !== i) {
          await surveysApi.updateQuestion(ordered[i].id, { order_index: i });
        }
      }
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "排序失敗"));
    } finally { setBusy(false); }
  };

  const move = (index: number, dir: -1 | 1) => {
    void reorder(index, index + dir);
  };

  const addQuestion = async () => {
    if (!survey) return;
    const isImg = newType === "image";
    const isChoice = newType === "single" || newType === "multiple" || newType === "ranking";
    if (!isImg && !newText.trim()) { toast.error("請輸入題目或區塊文字"); return; }
    if (isImg && !newImageUrl) { toast.error("圖片題型請先上傳圖片"); return; }
    const optionEntries = newOptions.map((option, index) => ({
      option: option.trim(),
      images: newOptionImageSets[index] ?? [],
    })).filter(({ option }) => Boolean(option));
    const opts = optionEntries.map(({ option }) => option);
    if (isChoice && opts.length < 2) { toast.error("選擇題至少需 2 個選項"); return; }
    setBusy(true);
    try {
      const body: SurveyQuestionBody & { question_text: string; question_type: string } = {
        question_text: newText.trim() || "（圖片）",
        question_type: newType,
        is_required: DISPLAY_TYPES.has(newType) ? false : newRequired,
        options: isChoice ? opts : [],
        option_image_sets: isChoice ? optionEntries.map(({ images }) => images) : [],
        image_url: isImg || !DISPLAY_TYPES.has(newType) ? newImageUrl || undefined : undefined,
        order_index: survey.questions.length,
      };
      if (newType === "ranking") {
        body.min_value = 1;
        body.max_value = opts.length;
      }
      const created = await surveysApi.addQuestion(survey.id, body);
      setActiveQuestionId(created.id);
      setNewText("");
      setNewOptions([]);
      setNewOptionImageSets([]);
      setNewImageUrl("");
      toast.success("題目已新增");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "新增失敗"));
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={28} className="mx-auto mb-3 animate-spin" style={{ color: "var(--primary)" }} aria-label="載入中" />
        <p className="text-sm">載入中…</p>
      </div>
    );
  }
  if (!survey) {
    return <div className="py-20 text-center text-sm" style={{ color: "var(--text-muted)" }}>問卷不存在</div>;
  }
  const managesActivity = Boolean(
    survey.activity_id && activities.some((activity) => activity.id === survey.activity_id),
  );
  if (!can("survey:manage") && !managesActivity) {
    return <div className="py-20 text-center text-sm" style={{ color: "var(--text-muted)" }}>您沒有編輯問卷的權限</div>;
  }
  if (survey.status === "closed" || survey.status === "archived") {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        已截止或封存的問卷無法編輯。
        <div className="mt-3">
          <Link href={`/surveys/${encodeURIComponent(survey.title)}`} className="btn btn-ghost">返回問卷</Link>
        </div>
      </div>
    );
  }

  const needsOptions = newType === "single" || newType === "multiple" || newType === "ranking";
  const newIsDisplay = DISPLAY_TYPES.has(newType);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/surveys/${encodeURIComponent(survey.title)}`} className="topbar-icon-btn" aria-label="返回問卷">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>編輯問卷</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            {survey.status === "open" ? "問卷開放中，調整會即時生效" : "草稿編輯"}
          </p>
        </div>
      </div>

      <GovernanceLinkPanel
        entityType="survey"
        entityId={survey.id}
        title={survey.title}
        href={`/surveys/${encodeURIComponent(survey.title)}`}
      />

      {/* 基本資料 */}
      <div className="card p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>基本資料</h3>
        <div>
          <Label>問卷標題</Label>
          <input value={title} onChange={e => setTitle(e.target.value)} className="input" />
        </div>
        <div>
          <Label>描述說明</Label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
            className="input resize-y" />
        </div>
        <div>
          <Label>截止時間（選填）</Label>
          <input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)}
            className="input" style={{ colorScheme: "dark" }} />
        </div>
        <ActivitySelect value={activityId} onChange={setActivityId} onActivitiesLoaded={setActivities} />

        {/* 開放對象 */}
        <div className="rounded-xl p-3 space-y-2.5" style={{ background: "var(--bg-elevated)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>開放對象</p>
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
                            : { background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
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

        <button onClick={saveMeta} disabled={busy} className="btn btn-ghost w-full text-sm">儲存基本資料</button>
      </div>

      {/* 題目列表 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          題目（{survey.questions.length}）
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          點題目卡片即可編輯；可拖曳卡片或使用箭頭調整順序。
        </p>
        {survey.questions.map((q, idx) => (
          <QuestionRow
            key={q.id}
            q={q}
            index={idx}
            total={survey.questions.length}
            others={survey.questions.filter(o => o.id !== q.id)}
            busy={busy}
            onSave={saveQuestion}
            onDelete={deleteQuestion}
            onMove={move}
            isActive={activeQuestionId === q.id}
            onActivate={() => setActiveQuestionId(q.id)}
            onDragStart={() => setDraggedQuestionId(q.id)}
            onDragEnd={() => setDraggedQuestionId(null)}
            onDrop={() => {
              const sourceIndex = survey.questions.findIndex((question) => question.id === draggedQuestionId);
              void reorder(sourceIndex, idx);
              setDraggedQuestionId(null);
            }}
          />
        ))}
      </div>

      {/* 新增題目 */}
      <div className="card p-5 space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>新增題目</h3>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div>
            <Label>題型</Label>
            <select value={newType} onChange={e => {
              setNewType(e.target.value as QuestionType);
              setNewOptions([]);
              setNewOptionImageSets([]);
            }} className="input">
              {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <Label>{newType === "image" ? "圖片說明（選填）" : newIsDisplay ? "區塊文字" : "題目文字"}</Label>
            <textarea value={newText} onChange={e => setNewText(e.target.value)} rows={2}
              className="input resize-y" placeholder={newIsDisplay ? "請輸入顯示內容…" : "請輸入題目…"} />
          </div>
        </div>
        {!newIsDisplay && (
          <label className="flex min-h-11 items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={newRequired} onChange={event => setNewRequired(event.target.checked)}
              className="accent-sky-400" />
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>必填</span>
          </label>
        )}
        {needsOptions && (
          <OptionImageFields
            options={newOptions}
            value={newOptionImageSets}
            onChange={setNewOptionImageSets}
            onOptionsChange={setNewOptions}
            selectionStyle={newType === "multiple" ? "multiple" : newType === "ranking" ? "ranking" : "single"}
          />
        )}
        {(newType === "image" || !newIsDisplay) && (
          <SurveyImageField
            label={newType === "image" ? "圖片 *" : "附加圖片（選填）"}
            value={newImageUrl}
            onChange={setNewImageUrl}
            hint={newType === "image" ? "上傳後會單獨顯示為圖片區塊。" : "圖片會顯示在題目上方。"}
          />
        )}
        <button onClick={addQuestion} disabled={busy} className="btn btn-primary w-full text-sm">
          加入題目
        </button>
      </div>
    </div>
  );
}
