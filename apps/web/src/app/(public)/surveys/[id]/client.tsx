"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import QRCode from "qrcode";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { surveysApi, ApiError, apiErrorMessage, authFetch } from "@/lib/api";
import type {
  ConditionRule,
  SurveyOut,
  SurveyQuestionOut,
  SurveyResponseAdminItem,
  SurveyResponseOut,
  SurveyStats,
} from "@/lib/types";
import { apiUrl, uploadUrl } from "@/lib/config";
import { clearAuthCache } from "@/lib/auth-cache";
import { usePermissions } from "@/hooks/usePermissions";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import { recordRecent } from "@/lib/recents";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";
import SurveyImageViewer from "@/components/surveys/SurveyImageViewer";

const DISPLAY_TYPES = new Set(["section_text", "page_break", "image", "video"]);

const VALIDATION_LABELS: Record<string, string> = {
  email: "電子郵件", number: "數字", integer: "整數", url: "網址", phone: "電話號碼",
};

/** 組出文字題型的填答提示（字數限制 / 格式）。 */
function validationHint(q: SurveyQuestionOut): string {
  const parts: string[] = [];
  if (q.min_length != null) parts.push(`最少 ${q.min_length} 字`);
  if (q.max_length != null) parts.push(`最多 ${q.max_length} 字`);
  if (q.validation_rule) parts.push(`格式需為${VALIDATION_LABELS[q.validation_rule] ?? q.validation_rule}`);
  return parts.join(" · ");
}

type AnswerValue = { text: string; options: string[]; other_text?: string };
type AnswerMap = Record<string, AnswerValue>;
type AnonymousResponseTokens = Record<string, string>;

function SwitchAccountButton({ surveyId, className }: { surveyId: string; className: string }) {
  const [switching, setSwitching] = useState(false);

  const switchAccount = async () => {
    setSwitching(true);
    try {
      await authFetch(apiUrl("/auth/logout"), {
        method: "POST",
        credentials: "include",
        skipImpersonation: true,
      });
    } catch {
      // 即使 session 已經失效，也必須清掉本機快取，避免登入頁立即導回原帳號。
    }
    clearAuthCache();
    window.location.replace(`/login?next=${encodeURIComponent(`/surveys/${encodeURIComponent(surveyId)}`)}`);
  };

  return (
    <button type="button" onClick={switchAccount} disabled={switching} className={className}>
      {switching ? "正在切換…" : "切換帳號"}
    </button>
  );
}

function anonymousResponseTokenKey(surveyId: string): string {
  return `hcca:survey:${surveyId}:anonymous-response-tokens`;
}

function readAnonymousResponseTokens(surveyId: string): AnonymousResponseTokens {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(anonymousResponseTokenKey(surveyId)) ?? "{}") as unknown;
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function storeAnonymousResponseTokens(surveyId: string, tokens: AnonymousResponseTokens): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(anonymousResponseTokenKey(surveyId), JSON.stringify(tokens));
}

function emptyAnswers(questions: SurveyQuestionOut[]): AnswerMap {
  return Object.fromEntries(
    questions
      .filter(question => !DISPLAY_TYPES.has(question.question_type))
      .map(question => [question.id, { text: "", options: [] }]),
  );
}

function answersFromResponse(survey: SurveyOut, response: SurveyResponseOut): AnswerMap {
  const answers = emptyAnswers(survey.questions);
  const questionsById = new Map(survey.questions.map(question => [question.id, question]));
  for (const answer of response.answers) {
    if (!answers[answer.question_id]) continue;
    const question = questionsById.get(answer.question_id);
    answers[answer.question_id] = {
      text: question?.question_type === "single" ? "" : (answer.answer_text ?? ""),
      options: question?.question_type === "single"
        ? (answer.answer_text ? [answer.answer_text] : [])
        : (answer.answer_options ?? []),
      other_text: answer.other_text ?? undefined,
    };
  }
  return answers;
}

function responseTimeLabel(response: SurveyResponseOut): string {
  return new Date(response.submitted_at).toLocaleString("zh-TW", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function hasAnswerContent(answer: AnswerValue | undefined): boolean {
  return Boolean(
    answer?.text.trim()
    || answer?.options.length,
  );
}

function questionValidationError(question: SurveyQuestionOut, answer: AnswerValue | undefined): string | null {
  if (question.is_required && !hasAnswerContent(answer)) return "此題為必填，請完成填答。";
  if (question.question_type === "multiple" && question.max_value != null) {
    if ((answer?.options.length ?? 0) > question.max_value) {
      return `最多可選 ${question.max_value} 個選項。`;
    }
  }
  if (question.question_type !== "ranking") return null;

  const chosen = answer?.options ?? [];
  const min = question.min_value ?? (question.is_required ? 1 : 0);
  const max = question.max_value ?? (question.options ?? []).length;
  if (question.is_required && chosen.length < Math.max(min, 1)) {
    return `至少需排序 ${Math.max(min, 1)} 項。`;
  }
  if (chosen.length > 0 && chosen.length < min) return `至少需排序 ${min} 項。`;
  if (chosen.length > max) return `最多只能排序 ${max} 項。`;
  return null;
}

/** 評估單一條件規則。 */
function evalRule(rule: ConditionRule, answers: AnswerMap): boolean {
  const ans = answers[rule.question_id];
  if (!ans) return false;
  const text = (ans.text ?? "").trim();
  const opts = ans.options ?? [];
  const val = (rule.value ?? "").trim();
  if (rule.operator === "contains") {
    return val !== "" && (text.includes(val) || opts.some(o => o.includes(val)));
  }
  return text === val || opts.includes(val);
}

/** 評估顯示條件（多規則由上到下依序左結合：且／或）。 */
function conditionMet(cond: NonNullable<SurveyQuestionOut["condition"]>, answers: AnswerMap): boolean {
  const rules = cond.rules ?? [];
  if (rules.length === 0) return true;
  let result = evalRule(rules[0], answers);
  for (let i = 1; i < rules.length; i += 1) {
    result = rules[i].connector === "or"
      ? result || evalRule(rules[i], answers)
      : result && evalRule(rules[i], answers);
  }
  return result;
}

/** 依顯示條件計算目前應隱藏的題目 id（分頁條件未成立時，整頁題目皆隱藏）。 */
function computeHidden(questions: SurveyQuestionOut[], answers: AnswerMap): Set<string> {
  const hidden = new Set<string>();
  let pageHidden = false;
  for (const q of questions) {
    if (q.question_type === "page_break") {
      pageHidden = q.condition ? !conditionMet(q.condition, answers) : false;
      if (pageHidden) hidden.add(q.id);
      continue;
    }
    if (pageHidden) { hidden.add(q.id); continue; }
    if (q.condition && !conditionMet(q.condition, answers)) hidden.add(q.id);
  }
  return hidden;
}

/* ── 排序題：可拖拉的「已選」清單 + 可點擊新增的「未選」清單 ───────────── */
function RankingInput({
  selected, unselected, minN, maxN, onMove, onAdd, onRemove,
}: {
  selected: string[];
  unselected: string[];
  minN: number;
  maxN: number;
  onMove: (event: DragEndEvent) => void;
  onAdd: (opt: string) => void;
  onRemove: (opt: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canAdd = selected.length < maxN;
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        請從下方點選並拖拉排序（最少 {minN} 項{maxN !== minN ? `、最多 ${maxN} 項` : ""}）
        — 目前已選 <strong style={{ color: "var(--primary)" }}>{selected.length}</strong> 項
      </p>

      {selected.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onMove}>
          <SortableContext items={selected} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {selected.map((opt, idx) => (
                <SortableRankRow key={opt} id={opt} rank={idx + 1} label={opt}
                  onRemove={() => onRemove(opt)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {unselected.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {selected.length === 0 ? "選項" : "其他選項（點擊加入排序）"}
          </p>
          {unselected.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => onAdd(opt)}
              disabled={!canAdd}
              className="w-full flex items-center gap-2 p-2.5 rounded-xl text-left transition-[color,background-color,border-color,opacity,box-shadow,transform]"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                opacity: canAdd ? 1 : 0.45,
                cursor: canAdd ? "pointer" : "not-allowed",
              }}
              aria-label={`加入「${opt}」到排序`}>
              <span className="text-xs w-6 text-center" style={{ color: "var(--text-muted)" }}>＋</span>
              <span className="text-sm flex-1">{opt}</span>
            </button>
          ))}
        </div>
      )}

      {!canAdd && unselected.length > 0 && (
        <p className="text-xs" style={{ color: "var(--warning)" }}>
          已達最多 {maxN} 項上限，如要新增請先移除一項。
        </p>
      )}
    </div>
  );
}

/* ── 排序題的單一可拖拉項目 ───────────────────────────────────────────────── */
function SortableRankRow({ id, rank, label, onRemove }: {
  id: string; rank: number; label: string; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        background: "var(--primary-dim)",
        border: "1px solid var(--border-strong)",
        opacity: isDragging ? 0.6 : 1,
      }}
      className="flex items-center gap-2 p-2.5 rounded-xl">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none p-1 rounded"
        style={{ color: "var(--text-muted)" }}
        aria-label="拖拉調整順序">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      <span className="text-xs font-bold w-6 text-center tabular-nums"
        style={{ color: "var(--primary)" }}>{rank}</span>
      <span className="text-sm flex-1" style={{ color: "var(--text-primary)" }}>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="topbar-icon-btn"
        aria-label="從排序中移除"
        style={{ color: "var(--danger)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/* ── 各題型的填答元件 ─────────────────────────────────────────────────────── */
function QuestionInput({
  question, value, onChange,
}: {
  question: SurveyQuestionOut;
  value: AnswerValue;
  onChange: (val: AnswerValue) => void;
}) {
  const {
    question_type: type,
    options: rawOptions,
    min_value,
    max_value,
    placeholder,
  } = question;
  const options = rawOptions ?? [];
  const imageSets = (
    question as SurveyQuestionOut & { option_image_sets?: string[][] }
  ).option_image_sets ?? [];
  const minV = min_value ?? 1;
  const maxV = max_value ?? 5;
  const optionGallery = options.flatMap((option, optionIndex) => (
    (imageSets[optionIndex] ?? []).map((image) => ({ image, optionLabel: option, optionIndex }))
  ));
  const optionPreview = (option: string, index: number, onSelect: (optionIndex: number) => void) => {
    const images = imageSets[index] ?? [];
    if (!images.length) return null;
    return (
      <SurveyImageViewer
        images={images}
        optionLabel={option}
        gallery={optionGallery}
        onSelect={onSelect}
        selectedOptionIndexes={value.options
          .map((selected) => options.indexOf(selected))
          .filter((selectedIndex) => selectedIndex >= 0)}
      />
    );
  };

  if (type === "section_text") {
    return (
      <p className="text-sm whitespace-pre-wrap leading-7" style={{ color: "var(--text-secondary)" }}>
        {question.question_text}
      </p>
    );
  }
  if (type === "page_break") {
    return <hr style={{ borderColor: "var(--border)" }} />;
  }
  if (type === "image") {
    const src = uploadUrl(question.image_url || placeholder || "");
    return (
      <figure className="space-y-2">
        {src && (
          <Image src={src} alt={question.question_text || "問卷圖片"}
            width={640}
            height={360}
            unoptimized
            sizes="(max-width: 640px) 100vw, 640px"
            className="max-h-80 w-full rounded-lg object-contain" />
        )}
        {question.question_text && (
          <figcaption className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>
            {question.question_text}
          </figcaption>
        )}
      </figure>
    );
  }
  if (type === "video") {
    return (
      <div className="space-y-2">
        <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
          {question.question_text}
        </p>
        {placeholder && (
          <a href={placeholder} target="_blank" rel="noreferrer" className="btn btn-ghost inline-flex text-xs">
            開啟影片
          </a>
        )}
      </div>
    );
  }

  if (type === "text") {
    const hint = validationHint(question);
    return (
      <div className="space-y-1">
        <input
          value={value.text}
          onChange={e => onChange({ ...value, text: e.target.value })}
          placeholder={placeholder ?? "請輸入…"}
          maxLength={question.max_length ?? undefined}
          className="input"
        />
        {hint && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{hint}</p>}
      </div>
    );
  }
  if (type === "textarea") {
    const hint = validationHint(question);
    return (
      <div className="space-y-1">
        <textarea
          value={value.text}
          onChange={e => onChange({ ...value, text: e.target.value })}
          rows={3}
          placeholder={placeholder ?? "請輸入…"}
          maxLength={question.max_length ?? undefined}
          className="input resize-y"
        />
        {hint && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{hint}</p>}
      </div>
    );
  }
  if (type === "date") {
    return (
      <input
        type="date"
        value={value.text}
        onChange={e => onChange({ ...value, text: e.target.value })}
        className="input"
        style={{ colorScheme: "dark" }}
      />
    );
  }
  if (type === "single") {
    return (
      <div className="space-y-2">
        {options.map((opt, index) => (
          <div key={opt} className="rounded-xl p-2.5" style={{
            background: value.options[0] === opt ? "var(--primary-dim)" : "var(--bg-elevated)",
            border: `1px solid ${value.options[0] === opt ? "var(--border-strong)" : "var(--border)"}`,
          }}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name={question.id}
                checked={value.options[0] === opt}
                onChange={() => onChange({ ...value, options: [opt] })}
                className="accent-sky-400"
              />
              <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{opt}</span>
            </label>
            {optionPreview(opt, index, (optionIndex) => onChange({ ...value, options: [options[optionIndex]] }))}
          </div>
        ))}
      </div>
    );
  }
  if (type === "multiple") {
    const exclusive = new Set(question.option_config?.exclusive ?? []);
    const otherSet = new Set(question.option_config?.other ?? []);
    const maxSelections = question.max_value ?? null;
    const otherChosen = value.options.some(o => otherSet.has(o));
    const toggle = (opt: string) => {
      const checked = value.options.includes(opt);
      let next: string[];
      if (checked) {
        next = value.options.filter(o => o !== opt);
      } else if (exclusive.has(opt)) {
        // 勾選互斥選項 → 清空其他
        next = [opt];
      } else {
        const selectedNormalOptions = value.options.filter(selected => !exclusive.has(selected));
        if (maxSelections != null && selectedNormalOptions.length >= maxSelections) return;
        // 勾選一般選項 → 清掉所有互斥選項
        next = [...value.options.filter(o => !exclusive.has(o)), opt];
      }
      const stillHasOther = next.some(o => otherSet.has(o));
      onChange({ ...value, options: next, other_text: stillHasOther ? value.other_text : undefined });
    };
    return (
      <div className="space-y-2">
        {maxSelections != null && (
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            最多可選 {maxSelections} 項（目前已選 {value.options.length} 項）
          </p>
        )}
        {options.map((opt, index) => {
          const checked = value.options.includes(opt);
          const isExcl = exclusive.has(opt);
          const isOther = otherSet.has(opt);
          const limitReached = maxSelections != null && value.options.length >= maxSelections;
          return (
            <div key={opt}>
              <div className="rounded-xl p-2.5" style={{
                background: checked ? "var(--primary-dim)" : "var(--bg-elevated)",
                border: `1px solid ${checked ? "var(--border-strong)" : "var(--border)"}`,
              }}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  disabled={!checked && !isExcl && limitReached}
                  className="accent-sky-400"
                />
                <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{opt}</span>
                {isExcl && (
                  <span className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>互斥</span>
                )}
              </label>
              {optionPreview(opt, index, (optionIndex) => toggle(options[optionIndex]))}
              </div>
              {isOther && checked && (
                <input
                  value={value.other_text ?? ""}
                  onChange={e => onChange({ ...value, other_text: e.target.value })}
                  placeholder="請輸入..."
                  maxLength={2000}
                  className="input mt-1.5 ml-7"
                  style={{ width: "calc(100% - 1.75rem)" }}
                />
              )}
            </div>
          );
        })}
        {!otherChosen && value.other_text && (
          /* 沒勾「其他」就清掉，避免送出多餘文字 */
          <></>
        )}
      </div>
    );
  }
  if (type === "ranking") {
    const minN = question.min_value ?? 1;
    const maxN = question.max_value ?? options.length;
    const selected = value.options.filter(o => options.includes(o));
    const unselected = options.filter(o => !selected.includes(o));
    const canAddMore = selected.length < maxN;

    const move = (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = selected.indexOf(String(active.id));
      const newIdx = selected.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return;
      onChange({ ...value, options: arrayMove(selected, oldIdx, newIdx) });
    };
    const addOpt = (opt: string) => {
      if (!canAddMore) return;
      onChange({ ...value, options: [...selected, opt] });
    };
    const removeOpt = (opt: string) => {
      onChange({ ...value, options: selected.filter(o => o !== opt) });
    };

    return (
      <RankingInput
        selected={selected}
        unselected={unselected}
        minN={minN}
        maxN={maxN}
        onMove={move}
        onAdd={addOpt}
        onRemove={removeOpt}
      />
    );
  }
  if (type === "rating") {
    const current = parseInt(value.text) || 0;
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: maxV - minV + 1 }, (_, i) => i + minV).map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ ...value, text: String(n) })}
            className="w-10 h-10 rounded-xl text-sm font-semibold transition-[color,background-color,border-color,opacity,box-shadow,transform]"
            style={current === n
              ? { background: "var(--primary)", color: "white", border: "none" }
              : { background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            {n}
          </button>
        ))}
        <span className="self-center text-xs ml-2" style={{ color: "var(--text-muted)" }}>
          {minV}（{question.min_label || "最低"}） → {maxV}（{question.max_label || "最高"}）
        </span>
      </div>
    );
  }
  return null;
}

/* ── 分享問卷（複製連結 + QR code） ───────────────────────────────────────── */
function ShareModal({ surveyId, title, onClose }: { surveyId: string; title: string; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/surveys/${encodeURIComponent(surveyId)}`
      : "";

  useEffect(() => {
    if (!shareUrl) return;
    QRCode.toDataURL(shareUrl, { width: 240, margin: 1 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [shareUrl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("已複製填答連結");
    } catch {
      toast.error("複製失敗，請手動複製");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--bg-overlay)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="分享問卷">
      <div className="card p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>分享問卷</h3>
          <button onClick={onClose} className="topbar-icon-btn" aria-label="關閉">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          掃描 QR code 或複製連結，邀請他人填答此問卷。
        </p>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="問卷 QR code" className="mx-auto rounded-lg"
            width={200}
            height={200}
            style={{ width: 200, height: 200 }} />
        )}
        <div className="flex gap-2">
          <input readOnly value={shareUrl} className="input flex-1 text-xs"
            onFocus={e => e.target.select()} aria-label="填答連結" />
          <button onClick={copy} className="btn btn-primary flex-shrink-0 text-xs">複製連結</button>
        </div>
        <AnimatedDownloadButton
          disabled={!qr}
          className="btn btn-ghost w-full text-xs"
          request={() => fetch(qr!).then((response) => response.blob())}
          filename={`${title}-QRcode.png`}
          label="下載 QR code 圖片"
          onError={() => toast.error("QR code 下載失敗")} />
      </div>
    </div>
  );
}

/* ── 統計視圖（管理員） ───────────────────────────────────────────────────── */
function StatsView({ surveyId }: { surveyId: string }) {
  const [stats, setStats] = useState<SurveyStats | null>(null);
  const [responses, setResponses] = useState<SurveyResponseAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartTypes, setChartTypes] = useState<Record<string, string>>({});
  const [view, setView] = useState<"charts" | "responses">("charts");
  const [deletingResponseId, setDeletingResponseId] = useState<string | null>(null);
  const [clearingResponses, setClearingResponses] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStats, nextResponses] = await Promise.all([
        surveysApi.stats(surveyId),
        surveysApi.responses(surveyId),
      ]);
      setStats(nextStats);
      setResponses(nextResponses);
    } catch {
      toast.error("載入統計失敗");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => { void loadStats(); }, [loadStats]);

  const deleteResponse = async (responseId: string) => {
    if (!confirm("確定刪除這筆回應？刪除後無法復原。")) return;
    setDeletingResponseId(responseId);
    try {
      await surveysApi.deleteResponse(surveyId, responseId);
      toast.success("回應已刪除");
      await loadStats();
    } catch (error) {
      toast.error(apiErrorMessage(error, "刪除回應失敗"));
    } finally {
      setDeletingResponseId(null);
    }
  };

  const clearResponses = async () => {
    if (!confirm("確定清除這份問卷的全部回應？所有答案都會永久刪除，且無法復原。")) return;
    setClearingResponses(true);
    try {
      await surveysApi.clearResponses(surveyId);
      toast.success("全部回應已清除");
      await loadStats();
    } catch (error) {
      toast.error(apiErrorMessage(error, "清除回應失敗"));
    } finally {
      setClearingResponses(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>統計載入中…</div>;
  if (!stats) return null;

  const renderPie = (qs: NonNullable<SurveyStats["questions"]>[number]) => {
    const entries = Object.entries(qs.option_counts ?? {}).sort(([, a], [, b]) => b - a);
    if (entries.length === 0) return null;
    const total = entries.reduce((sum, [, count]) => sum + (count as number), 0) || 1;
    const colors = ["#38bdf8", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#14b8a6"];
    let offset = 25;
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <svg viewBox="0 0 42 42" className="h-32 w-32 -rotate-90">
          {entries.map(([opt, count], index) => {
            const value = (count / total) * 100;
            const node = (
              <circle
                key={opt}
                cx="21"
                cy="21"
                r="15.915"
                fill="transparent"
                stroke={colors[index % colors.length]}
                strokeWidth="8"
                strokeDasharray={`${value} ${100 - value}`}
                strokeDashoffset={offset}
              />
            );
            offset -= value;
            return node;
          })}
        </svg>
        <div className="space-y-1.5">
          {entries.map(([opt, count], index) => (
            <div key={opt} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />
              <span style={{ color: "var(--text-secondary)" }}>{opt}</span>
              <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
                {count}（{Math.round((count / total) * 100)}%）
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const questionLabels = new Map((stats.questions ?? []).map(q => [q.question_id, q.question_text]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 rounded-xl"
        style={{ background: "var(--info-dim)", border: "1px solid rgba(37,99,235,0.2)" }}>
        <p className="text-sm" style={{ color: "var(--info)" }}>
          共 <strong>{stats.total_responses}</strong> 份回應
        </p>
        {stats.total_responses > 0 && (
          <button
            type="button"
            onClick={() => { void clearResponses(); }}
            disabled={clearingResponses || deletingResponseId !== null}
            className="btn btn-ghost text-xs"
            style={{ color: "var(--danger)" }}>
            {clearingResponses ? "清除中…" : "清除全部回應"}
          </button>
        )}
        <div className="flex gap-1 ml-auto p-1 rounded-lg" style={{ background: "var(--bg-surface)" }}>
          {(["charts", "responses"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color,border-color,opacity,box-shadow,transform]"
              style={view === v
                ? { background: "var(--primary)", color: "var(--primary-fg)" }
                : { color: "var(--text-muted)" }}>
              {v === "charts" ? "圖表統計" : "個別回應"}
            </button>
          ))}
        </div>
        <AnimatedDownloadButton
          className="btn btn-ghost text-xs flex-shrink-0"
          request={() => surveysApi.exportSpreadsheet(surveyId)}
          filename={`${stats.title ?? "問卷回應"}.xlsx`}
          label="匯出試算表"
          onComplete={() => toast.success("試算表已開始下載")}
          onError={(error) => toast.error(apiErrorMessage(error, "匯出失敗"))} />
      </div>

      {view === "charts" && stats.total_responses === 0 && (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          尚無填答回應
        </div>
      )}

      {view === "charts" && (stats.questions ?? []).map(qs => (
        <div key={qs.question_id} className="card p-5 space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {qs.question_text}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{qs.total_responses} 份回答</p>
          {(qs.available_charts ?? []).length > 1 && (
            <div className="flex gap-1">
              {(qs.available_charts ?? []).map(chart => (
                <button
                  key={chart}
                  type="button"
                  onClick={() => setChartTypes(prev => ({ ...prev, [qs.question_id]: chart }))}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={(chartTypes[qs.question_id] ?? qs.suggested_chart) === chart
                    ? { color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }
                    : { color: "var(--text-muted)", border: "1px solid var(--border)" }}
                >
                  {chart === "pie" ? "圓餅圖" : chart === "bar" ? "長條圖" : "列表"}
                </button>
              ))}
            </div>
          )}

          {(chartTypes[qs.question_id] ?? qs.suggested_chart) === "pie" && renderPie(qs)}

          {/* 選項票數 */}
          {Object.keys(qs.option_counts ?? {}).length > 0 && (chartTypes[qs.question_id] ?? qs.suggested_chart) !== "pie" && (
            <div className="space-y-2.5">
              {Object.entries(qs.option_counts ?? {})
                .sort(([, a], [, b]) => b - a)
                .map(([opt, count]) => {
                  const pct = qs.total_responses > 0 ? Math.round((count / qs.total_responses) * 100) : 0;
                  return (
                    <div key={opt} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: "var(--text-secondary)" }}>{opt}</span>
                        <span className="font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
                          {count} <span style={{ opacity: 0.6 }}>({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
                        <div
                          className="h-full rounded-full transition-[width] duration-500 ease-out"
                          style={{ width: `${pct}%`, background: "var(--primary)" }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* 平均評分 */}
          {qs.average_rating != null && (
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold" style={{ color: "var(--primary)" }}>
                {qs.average_rating.toFixed(1)}
              </p>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                平均分（滿分 {qs.total_responses > 0 ? "N" : "—"}）
              </span>
            </div>
          )}

          {/* 文字回答 */}
          {(qs.text_answers ?? []).length > 0 && (
            <div>
              <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                文字回答（{(qs.text_answers ?? []).length} 則）
              </p>
              <ul
                className="space-y-1.5 overflow-y-auto pr-1"
                style={{ maxHeight: "12rem" }}
                aria-label="文字回答列表">
                {(qs.text_answers ?? []).map((ans, i) => (
                  <li key={i}
                    className="text-xs px-3 py-2 rounded-lg whitespace-pre-wrap break-words"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                    {ans}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      {view === "responses" && (
        responses.length === 0 ? (
          <div className="card p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            尚無填答回應
          </div>
        ) : (
          <div className="space-y-3">
            {responses.map((r, idx) => (
              <div key={r.id} className="card p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold" style={{ color: "var(--primary)" }}>
                    #{responses.length - idx}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {r.respondent_email ?? "匿名填答"}
                  </span>
                  <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
                    {new Date(r.submitted_at).toLocaleString("zh-TW")}
                  </span>
                  <button
                    type="button"
                    onClick={() => { void deleteResponse(r.id); }}
                    disabled={clearingResponses || deletingResponseId !== null}
                    className="btn btn-ghost px-2 py-1 text-xs"
                    style={{ color: "var(--danger)" }}>
                    {deletingResponseId === r.id ? "刪除中…" : "刪除"}
                  </button>
                </div>
                <div className="space-y-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                  {r.answers.length === 0 ? (
                    <p className="text-xs pt-2" style={{ color: "var(--text-muted)" }}>（無作答內容）</p>
                  ) : (
                    r.answers.map(a => {
                      const label = questionLabels.get(a.question_id) ?? "題目";
                      const val = (a.answer_options ?? []).length
                        ? (a.answer_options ?? []).join("、")
                        : (a.answer_text || "—");
                      return (
                        <div key={a.id} className="text-xs pt-1.5">
                          <span style={{ color: "var(--text-muted)" }}>{label}</span>
                          <p className="mt-0.5 whitespace-pre-wrap break-words"
                            style={{ color: "var(--text-primary)" }}>{val}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/* ── 主頁面 ───────────────────────────────────────────────────────────────── */
export default function SurveyDetailClient({
  initialSurvey,
}: {
  initialSurvey?: SurveyOut | null;
} = {}) {
  const params = useParams();
  const { can } = usePermissions();
  const id = params.id as string;

  const [survey, setSurvey] = useState<SurveyOut | null>(initialSurvey ?? null);
  const [loading, setLoading] = useState(initialSurvey == null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [myResponses, setMyResponses] = useState<SurveyResponseOut[]>([]);
  const [editingResponseId, setEditingResponseId] = useState<string | null>(null);
  const [editingAnonToken, setEditingAnonToken] = useState<string | null>(null);
  const [anonymousResponseTokens, setAnonymousResponseTokens] = useState<AnonymousResponseTokens>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [viewStats, setViewStats] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [emailCopy, setEmailCopy] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const questionElements = useRef<Record<string, HTMLDivElement | null>>({});
  const answerDraft = useMemo(() => answers, [answers]);
  const responseDraftKey = `surveys:${id}:response:${editingResponseId ?? "new"}`;
  const hiddenIds = useMemo(
    () => (survey ? computeHidden(survey.questions, answers) : new Set<string>()),
    [survey, answers],
  );
  const numberMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!survey) return m;
    let n = 0;
    for (const q of survey.questions) {
      if (!DISPLAY_TYPES.has(q.question_type) && !hiddenIds.has(q.id)) {
        n += 1;
        m.set(q.id, n);
      }
    }
    return m;
  }, [survey, hiddenIds]);
  const restoreAnswerDraft = useCallback((draft: AnswerMap) => {
    setAnswers(prev => ({ ...prev, ...draft }));
    toast.info("已復原未送出的問卷填答草稿");
  }, []);
  const { clearDraft, flushDraft, lastSavedAt } = useDraftAutosave({
    key: responseDraftKey,
    value: answerDraft,
    onRestore: restoreAnswerDraft,
    enabled: Boolean(survey && survey.status === "open" && !submitted && !viewStats),
    isEmpty: useCallback((draft: AnswerMap) => (
      Object.values(draft).every(ans =>
        !(ans.text ?? "").trim()
        && (ans.options ?? []).length === 0
        && !(ans.other_text ?? "").trim()
      )
    ), []),
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // 未登入者改用公開端點（僅開放未登入填答的問卷可取得）
    const loggedIn = typeof window !== "undefined" && Boolean(localStorage.getItem("user_id"));
    const fetcher = loggedIn ? surveysApi.get(id) : surveysApi.getPublic(id);
    try {
      const loadedSurvey = await fetcher;
      setSurvey(loadedSurvey);
      const initialAnswers = emptyAnswers(loadedSurvey.questions);

      if (loadedSurvey.is_anonymous) {
        const tokens = readAnonymousResponseTokens(id);
        const responses = (await Promise.all(
          Object.entries(tokens).map(async ([responseId, token]) => {
            try {
              const [response] = await surveysApi.myResponses(id, token);
              return response?.id === responseId ? response : null;
            } catch {
              return null;
            }
          }),
        )).filter((response): response is SurveyResponseOut => response !== null);
        setAnonymousResponseTokens(tokens);
        setMyResponses(responses);
        if (!loadedSurvey.allow_multiple && responses[0]) {
          setEditingResponseId(responses[0].id);
          setEditingAnonToken(tokens[responses[0].id] ?? null);
          setAnswers(answersFromResponse(loadedSurvey, responses[0]));
        } else {
          setEditingResponseId(null);
          setEditingAnonToken(null);
          setAnswers(initialAnswers);
        }
      } else if (loggedIn) {
        const responses = await surveysApi.myResponses(id);
        setMyResponses(responses);
        setAnonymousResponseTokens({});
        if (!loadedSurvey.allow_multiple && responses[0]) {
          setEditingResponseId(responses[0].id);
          setEditingAnonToken(null);
          setAnswers(answersFromResponse(loadedSurvey, responses[0]));
        } else {
          setEditingResponseId(null);
          setEditingAnonToken(null);
          setAnswers(initialAnswers);
        }
      } else {
        setMyResponses([]);
        setEditingResponseId(null);
        setEditingAnonToken(null);
        setAnonymousResponseTokens({});
        setAnswers(initialAnswers);
      }
    } catch (error) {
      setSurvey(null);
      setMyResponses([]);
      setEditingAnonToken(null);
      setAnonymousResponseTokens({});
      setLoadError(apiErrorMessage(error, "無法載入問卷"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (survey) recordRecent({ kind: "survey", id: survey.id, title: survey.title, href: `/surveys/${encodeURIComponent(survey.id)}` });
  }, [survey]);

  const showValidationErrors = (errors: Record<string, string>) => {
    setValidationErrors(errors);
    const [firstQuestionId] = Object.keys(errors);
    if (!firstQuestionId) return;
    toast.error(`尚有 ${Object.keys(errors).length} 題需要完成，已帶你前往第一題。`);
    window.requestAnimationFrame(() => {
      const question = questionElements.current[firstQuestionId];
      question?.scrollIntoView({ behavior: "smooth", block: "center" });
      question?.querySelector<HTMLElement>("input, textarea, button")?.focus({ preventScroll: true });
    });
  };

  const submit = async () => {
    if (!survey) return;
    const errors: Record<string, string> = {};
    for (const q of survey.questions) {
      if (DISPLAY_TYPES.has(q.question_type) || hiddenIds.has(q.id)) continue;
      const error = questionValidationError(q, answers[q.id]);
      if (error) errors[q.id] = error;
    }
    if (Object.keys(errors).length > 0) {
      showValidationErrors(errors);
      return;
    }
    setValidationErrors({});

    setSubmitting(true);
    try {
      const anon_token = survey.is_anonymous ? (editingAnonToken ?? crypto.randomUUID()) : undefined;
      const payload = {
        answers: survey.questions
          .filter(q => !DISPLAY_TYPES.has(q.question_type) && !hiddenIds.has(q.id))
          .map(q => ({
            question_id: q.id,
            answer_text: answers[q.id]?.text || undefined,
            answer_options: answers[q.id]?.options,
            other_text: answers[q.id]?.other_text || undefined,
          })),
        anon_token,
        email_copy: emailCopy,
      };
      const response = editingResponseId
        ? await surveysApi.updateResponse(id, editingResponseId, payload)
        : await surveysApi.submit(id, payload);
      setMyResponses(previous => {
        const withoutUpdated = previous.filter(item => item.id !== response.id);
        return [response, ...withoutUpdated];
      });
      if (survey.is_anonymous && anon_token) {
        setAnonymousResponseTokens(previous => {
          const next = { ...previous, [response.id]: anon_token };
          storeAnonymousResponseTokens(id, next);
          return next;
        });
      }
      clearDraft();
      toast.success(editingResponseId ? "答案已更新" : "填答成功，感謝您的參與！");
      setSubmitted(true);
    } catch (e) {
      flushDraft();
      if (e instanceof ApiError && e.status === 409) {
        toast.error("您已填答過此問卷");
      } else {
        toast.error(apiErrorMessage(e, "提交失敗"));
      }
    } finally { setSubmitting(false); }
  };

  const editResponse = (response: SurveyResponseOut) => {
    if (!survey) return;
    const anonToken = survey.is_anonymous ? anonymousResponseTokens[response.id] : null;
    if (survey.is_anonymous && !anonToken) {
      toast.error("找不到這份匿名回答的驗證資料，無法修改。");
      return;
    }
    setEditingResponseId(response.id);
    setEditingAnonToken(anonToken);
    setAnswers(answersFromResponse(survey, response));
    setValidationErrors({});
    setEmailCopy(false);
    setSubmitted(false);
  };

  const addResponse = () => {
    if (!survey || !survey.allow_multiple) return;
    setEditingResponseId(null);
    setEditingAnonToken(null);
    setAnswers(emptyAnswers(survey.questions));
    setValidationErrors({});
    setEmailCopy(false);
    setSubmitted(false);
  };

  const toggleStatus = async () => {
    if (!survey) return;
    if (survey.status === "open") {
      if (!confirm("確定關閉問卷？關閉後將不再接受新填答。")) return;
      setClosing(true);
      try {
        await surveysApi.close(id);
        toast.success("問卷已關閉");
        load();
      } catch (e) { toast.error(apiErrorMessage(e, "操作失敗")); }
      finally { setClosing(false); }
    } else if (survey.status === "draft" || survey.status === "closed") {
      setOpening(true);
      try {
        await surveysApi.open(id);
        toast.success("問卷已開放填答");
        load();
      } catch (e) { toast.error(apiErrorMessage(e, "操作失敗")); }
      finally { setOpening(false); }
    }
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
    const canSwitchAccount = loadError?.includes("校務帳號") || loadError?.includes("登入");
    return (
      <section className="card mx-auto max-w-xl space-y-4 p-7 text-center" role="alert" aria-live="assertive">
        <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>目前無法填寫這份問卷</h1>
        <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
          {loadError ?? "找不到這份問卷，或你目前沒有填答資格。"}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {canSwitchAccount && (
            <SwitchAccountButton surveyId={id} className="btn btn-primary" />
          )}
          <Link href="/surveys" className="btn btn-ghost">返回問卷列表</Link>
        </div>
      </section>
    );
  }

  const isAdmin = can("survey:manage");
  const isOpen = survey.status === "open";
  const allowedDomains = survey.allowed_domains ?? [];
  const responseQuestions = survey.questions.filter(
    (question) => !DISPLAY_TYPES.has(question.question_type) && !hiddenIds.has(question.id),
  );
  const questionCount = responseQuestions.length;
  const answeredQuestionCount = responseQuestions.filter(
    (question) => hasAnswerContent(answers[question.id]),
  ).length;
  const responseProgress = questionCount > 0 ? answeredQuestionCount / questionCount : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* 頁首 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Link href="/surveys" className="topbar-icon-btn flex-shrink-0" aria-label="返回問卷列表">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {survey.title}
            </h1>
          </div>
        </div>
        {/* 操作列 */}
        <div className="flex gap-2 flex-wrap sm:flex-shrink-0">
          <GovernanceLinkPanel
            entityType="survey"
            entityId={survey.id}
            title={survey.title}
            href={`/surveys/${survey.id}`}
            compact
          />
          <button
            onClick={() => setShareOpen(true)}
            className="btn btn-ghost text-xs"
            aria-label="分享問卷">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            分享
          </button>
          {isAdmin && (survey.status === "draft" || survey.status === "open") && (
            <Link
              href={`/surveys/${encodeURIComponent(survey.id)}/edit`}
              className="btn btn-ghost text-xs">
              編輯題目
            </Link>
          )}
          {isAdmin && (survey.status === "draft" || survey.status === "open" || survey.status === "closed") && (
            <button
              onClick={toggleStatus}
              disabled={opening || closing}
              className="btn btn-ghost text-xs"
              style={survey.status === "open" ? { color: "var(--danger)" } : survey.status === "closed" ? { color: "var(--success)" } : {}}>
              {opening ? "開放中…" : closing ? "關閉中…" : survey.status === "closed" ? "重新開放" : survey.status === "draft" ? "開放填答" : "關閉問卷"}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setViewStats(v => !v)}
              className="btn btn-ghost text-xs"
              style={viewStats ? { color: "var(--primary)" } : {}}>
              {viewStats ? "填答表單" : "查看統計"}
            </button>
          )}
        </div>
      </div>

      {survey.description && (
        <section
          className="rounded-xl px-5 py-4"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          aria-labelledby="survey-description-heading"
        >
          <h2 id="survey-description-heading" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            問卷說明
          </h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
            {survey.description}
          </p>
        </section>
      )}

      {/* 資訊列 */}
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="badge"
          style={{
            color: isOpen ? "var(--success)" : "var(--text-muted)",
            background: isOpen ? "var(--success-dim)" : "var(--bg-elevated)",
            borderColor: isOpen ? "var(--success)" : "var(--border)",
          }}>
          {survey.status === "open" ? "開放填答" : survey.status === "draft" ? "草稿" : survey.status === "closed" ? "已截止" : "封存"}
        </span>
        {survey.is_anonymous && (
          <span className="badge" style={{ color: "var(--info)", background: "var(--info-dim)", borderColor: "var(--info)" }}>
            匿名問卷
          </span>
        )}
        <span>{questionCount} 道題目</span>
        {isAdmin && <span>{survey.response_count} 份回應</span>}
        {survey.closes_at && (
          <span>截止 {new Date(survey.closes_at).toLocaleDateString("zh-TW")}</span>
        )}
      </div>

      {!survey.is_public && allowedDomains.length > 0 && (
        <aside
          className="flex flex-col gap-3 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          style={{ background: "var(--info-dim)", border: "1px solid rgba(37,99,235,0.24)" }}
          aria-label="校務帳號填答資格"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>校務帳號限定</p>
            <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
              此問卷限使用 {allowedDomains.map(domain => `@${domain.replace(/^@/, "")}`).join("、")}
              的校務帳號填答；已連結的校務帳號同樣符合資格。若目前帳號不符，請切換帳號後再填寫。
            </p>
          </div>
          <SwitchAccountButton
            surveyId={id}
            className="btn btn-ghost shrink-0 self-start text-xs sm:self-auto"
          />
        </aside>
      )}

      {/* 統計 / 填答 */}
      {isAdmin && viewStats ? (
        <StatsView surveyId={id} />
      ) : submitted ? (
        <section className="survey-response-receipt card p-8 text-center space-y-3" aria-live="polite">
          <div className="survey-response-receipt-seal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>你的回應已送出</h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            感謝你的填答。這份回應已成功提交至本次問卷。
          </p>
          {survey.is_anonymous && (
            <p className="survey-response-receipt-note text-xs">此份填答不會與你的身分連結。</p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {myResponses[0] && (
              <button type="button" onClick={() => editResponse(myResponses[0])} className="btn btn-ghost">
                修改這份回答
              </button>
            )}
            {survey.allow_multiple && (
              <button type="button" onClick={addResponse} className="btn btn-primary">
                新增一份回答
              </button>
            )}
            <Link href="/surveys" className="btn btn-ghost">返回問卷列表</Link>
          </div>
        </section>
      ) : !isOpen ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>此問卷目前不開放填答</p>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); submit(); }} className="survey-response-form space-y-4">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            標示 <span className="font-semibold" style={{ color: "var(--danger)" }}>「必填」</span>
            的題目須完成後才能送出。
          </p>
          {(!survey.is_anonymous || myResponses.length > 0) && (
            <section
              className="space-y-3 rounded-xl px-4 py-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
              aria-live="polite"
            >
              {survey.allow_multiple ? (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {editingResponseId ? "正在修改既有回答" : "正在填寫新的一份回答"}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        這份問卷允許多次提交；你可以新增回答，也可以隨時回來修改自己的既有回答。
                        {survey.is_anonymous && " 匿名回答僅能在這個瀏覽器中修改。"}
                      </p>
                    </div>
                    {editingResponseId && (
                      <button type="button" onClick={addResponse} className="btn btn-ghost shrink-0 text-xs">
                        新增一份回答
                      </button>
                    )}
                  </div>
                  {myResponses.length > 0 && (
                    <div className="flex flex-wrap gap-2" aria-label="既有回答">
                      {myResponses.map((response, index) => (
                        <button
                          key={response.id}
                          type="button"
                          onClick={() => editResponse(response)}
                          className="btn btn-ghost text-xs"
                          style={editingResponseId === response.id ? {
                            color: "var(--primary)", borderColor: "var(--primary)",
                          } : {}}
                        >
                          修改第 {myResponses.length - index} 份（{responseTimeLabel(response)}）
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : editingResponseId ? (
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    你已提交過這份問卷
                  </p>
                  <p className="mt-0.5 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                    此問卷每人只能提交一次。已載入你原本的回答，修改後請按「儲存變更」。
                    {survey.is_anonymous && " 匿名回答僅能在這個瀏覽器中修改。"}
                  </p>
                </div>
              ) : !survey.is_anonymous ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  此問卷每人只能提交一次；提交後仍可回來修改原本的回答。
                </p>
              ) : null}
            </section>
          )}
          <aside className="survey-response-meter" aria-label="填答進度" aria-live="polite">
            <div className="flex items-center justify-between gap-4">
              <span>填答進度</span>
              <strong className="tabular-nums">{answeredQuestionCount} / {questionCount} 題</strong>
            </div>
            <div className="survey-response-meter-track" aria-hidden="true">
              <span style={{ transform: `scaleX(${responseProgress})` }} />
            </div>
            {answeredQuestionCount === questionCount && questionCount > 0 && (
              <p>所有題目都已整理完成，可以送出了。</p>
            )}
            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {lastSavedAt
                ? `已於 ${new Date(lastSavedAt).toLocaleTimeString("zh-TW", {
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                })} 自動儲存到此裝置`
                : "填答內容會自動儲存到此裝置，意外離開後可繼續填寫。"}
            </p>
          </aside>
          {survey.questions.map((q) => {
            if (hiddenIds.has(q.id)) return null;
            const isDisplay = DISPLAY_TYPES.has(q.question_type);
            const isAnswered = hasAnswerContent(answers[q.id]);
            const validationError = validationErrors[q.id];
            return (
            <div
              key={q.id}
              ref={element => { questionElements.current[q.id] = element; }}
              className={isDisplay ? "py-2 space-y-3" : "survey-question-card card p-5 space-y-3"}
              data-answered={!isDisplay && isAnswered ? "true" : undefined}
              aria-invalid={validationError ? true : undefined}
              aria-describedby={validationError ? `question-error-${q.id}` : undefined}
              style={validationError ? {
                borderColor: "var(--danger)",
              } : undefined}
            >
              <div className="flex items-start gap-2">
                {!isDisplay && (
                  <span className="text-xs font-bold mt-0.5 flex-shrink-0"
                    style={{ color: "var(--primary)" }}>Q{numberMap.get(q.id)}</span>
                )}
                <div className="flex-1">
                  <p className={isDisplay ? "sr-only" : "text-sm font-medium"} style={{ color: "var(--text-primary)" }}>
                    {q.question_text}
                    {q.is_required && (
                      <span
                        className="ml-2 inline-flex rounded px-1.5 py-0.5 align-middle text-xs font-semibold"
                        style={{ background: "var(--danger-dim)", color: "var(--danger)" }}
                      >
                        必填
                      </span>
                    )}
                    {q.question_type === "multiple" && q.max_value != null && (
                      <span
                        className="ml-2 inline-flex rounded px-1.5 py-0.5 align-middle text-xs font-semibold"
                        style={{ background: "var(--info-dim)", color: "var(--info)" }}
                      >
                        最多選 {q.max_value} 項
                      </span>
                    )}
                    {!isDisplay && isAnswered && <span className="survey-question-recorded">已記錄</span>}
                  </p>
                </div>
              </div>
              {q.image_url && q.question_type !== "image" && (
                <Image src={uploadUrl(q.image_url)} alt=""
                  width={640}
                  height={360}
                  unoptimized
                  sizes="(max-width: 640px) 100vw, 640px"
                  className="max-h-72 w-full rounded-lg object-contain"
                  style={{ border: "1px solid var(--border)" }} />
              )}
              <QuestionInput
                question={q}
                value={answers[q.id] ?? { text: "", options: [] }}
                onChange={val => {
                  setAnswers(prev => ({ ...prev, [q.id]: val }));
                  setValidationErrors(previous => {
                    if (!previous[q.id]) return previous;
                    const nextError = questionValidationError(q, val);
                    if (nextError) return { ...previous, [q.id]: nextError };
                    const next = { ...previous };
                    delete next[q.id];
                    return next;
                  });
                }}
              />
              {validationError && (
                <p
                  id={`question-error-${q.id}`}
                  role="alert"
                  className="text-sm font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  {validationError}
                </p>
              )}
            </div>
            );
          })}

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={emailCopy}
              onChange={e => setEmailCopy(e.target.checked)}
              className="accent-sky-400"
            />
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              將回答副本寄送到我的電子郵件信箱
            </span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="btn flex-1"
              style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}
              aria-busy={submitting}>
              {submitting ? (editingResponseId ? "儲存中…" : "提交中…") : (editingResponseId ? "儲存變更" : "提交填答")}
            </button>
          </div>
          {survey.is_anonymous && (
            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              此為匿名問卷，您的身份不會與填答內容關聯
            </p>
          )}
        </form>
      )}

      {shareOpen && (
        <ShareModal surveyId={survey.id} title={survey.title} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
