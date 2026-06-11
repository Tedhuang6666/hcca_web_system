"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import QRCode from "qrcode";
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
import { surveysApi, ApiError, apiErrorMessage } from "@/lib/api";
import type { SurveyOut, SurveyQuestionOut, SurveyStats, SurveyResponseAdminItem, ConditionRule } from "@/lib/types";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import { recordRecent } from "@/lib/recents";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";

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
              className="w-full flex items-center gap-2 p-2.5 rounded-xl text-left transition-all"
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
  const { question_type: type, options, min_value, max_value, placeholder } = question;
  const minV = min_value ?? 1;
  const maxV = max_value ?? 5;

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
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={question.question_text || "問卷圖片"}
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
        {options.map(opt => (
          <label key={opt} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl transition-all"
            style={{
              background: value.options[0] === opt ? "var(--primary-dim)" : "var(--bg-elevated)",
              border: `1px solid ${value.options[0] === opt ? "var(--border-strong)" : "var(--border)"}`,
            }}>
            <input
              type="radio"
              name={question.id}
              checked={value.options[0] === opt}
              onChange={() => onChange({ ...value, options: [opt] })}
              className="accent-sky-400"
            />
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  if (type === "multiple") {
    const exclusive = new Set(question.option_config?.exclusive ?? []);
    const otherSet = new Set(question.option_config?.other ?? []);
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
        // 勾選一般選項 → 清掉所有互斥選項
        next = [...value.options.filter(o => !exclusive.has(o)), opt];
      }
      const stillHasOther = next.some(o => otherSet.has(o));
      onChange({ ...value, options: next, other_text: stillHasOther ? value.other_text : undefined });
    };
    return (
      <div className="space-y-2">
        {options.map(opt => {
          const checked = value.options.includes(opt);
          const isExcl = exclusive.has(opt);
          const isOther = otherSet.has(opt);
          return (
            <div key={opt}>
              <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl transition-all"
                style={{
                  background: checked ? "var(--primary-dim)" : "var(--bg-elevated)",
                  border: `1px solid ${checked ? "var(--border-strong)" : "var(--border)"}`,
                }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  className="accent-sky-400"
                />
                <span className="text-sm flex-1" style={{ color: "var(--text-primary)" }}>{opt}</span>
                {isExcl && (
                  <span className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>互斥</span>
                )}
              </label>
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
            className="w-10 h-10 rounded-xl text-sm font-semibold transition-all"
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
function ShareModal({ title, onClose }: { title: string; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/surveys/${encodeURIComponent(title)}`
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

  const downloadQr = () => {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = qr;
    a.download = `${title}-QRcode.png`;
    a.click();
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
            style={{ width: 200, height: 200 }} />
        )}
        <div className="flex gap-2">
          <input readOnly value={shareUrl} className="input flex-1 text-xs"
            onFocus={e => e.target.select()} aria-label="填答連結" />
          <button onClick={copy} className="btn btn-primary flex-shrink-0 text-xs">複製連結</button>
        </div>
        <button onClick={downloadQr} disabled={!qr} className="btn btn-ghost w-full text-xs">
          下載 QR code 圖片
        </button>
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
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState<"charts" | "responses">("charts");

  useEffect(() => {
    Promise.all([surveysApi.stats(surveyId), surveysApi.responses(surveyId)])
      .then(([s, r]) => { setStats(s); setResponses(r); })
      .catch(() => toast.error("載入統計失敗"))
      .finally(() => setLoading(false));
  }, [surveyId]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const blob = await surveysApi.exportSpreadsheet(surveyId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stats?.title ?? "問卷回應"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("試算表已開始下載");
    } catch (e) {
      toast.error(apiErrorMessage(e, "匯出失敗"));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>統計載入中…</div>;
  if (!stats) return null;

  const renderPie = (qs: SurveyStats["questions"][number]) => {
    const entries = Object.entries(qs.option_counts).sort(([, a], [, b]) => b - a);
    if (entries.length === 0) return null;
    const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
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

  const questionLabels = new Map(stats.questions.map(q => [q.question_id, q.question_text]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 rounded-xl"
        style={{ background: "var(--info-dim)", border: "1px solid rgba(37,99,235,0.2)" }}>
        <p className="text-sm" style={{ color: "var(--info)" }}>
          共 <strong>{stats.total_responses}</strong> 份回應
        </p>
        <div className="flex gap-1 ml-auto p-1 rounded-lg" style={{ background: "var(--bg-surface)" }}>
          {(["charts", "responses"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
              style={view === v
                ? { background: "var(--primary)", color: "var(--primary-fg)" }
                : { color: "var(--text-muted)" }}>
              {v === "charts" ? "圖表統計" : "個別回應"}
            </button>
          ))}
        </div>
        <button
          onClick={exportXlsx}
          disabled={exporting}
          className="btn btn-ghost text-xs flex-shrink-0"
          aria-busy={exporting}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {exporting ? "匯出中…" : "匯出試算表"}
        </button>
      </div>

      {view === "charts" && stats.total_responses === 0 && (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          尚無填答回應
        </div>
      )}

      {view === "charts" && stats.questions.map(qs => (
        <div key={qs.question_id} className="card p-5 space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {qs.question_text}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{qs.total_responses} 份回答</p>
          {qs.available_charts.length > 1 && (
            <div className="flex gap-1">
              {qs.available_charts.map(chart => (
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
          {Object.keys(qs.option_counts).length > 0 && (chartTypes[qs.question_id] ?? qs.suggested_chart) !== "pie" && (
            <div className="space-y-2.5">
              {Object.entries(qs.option_counts)
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
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${pct}%`, background: "var(--primary)" }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* 平均評分 */}
          {qs.average_rating !== null && (
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
          {qs.text_answers.length > 0 && (
            <div>
              <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                文字回答（{qs.text_answers.length} 則）
              </p>
              <ul
                className="space-y-1.5 overflow-y-auto pr-1"
                style={{ maxHeight: "12rem" }}
                aria-label="文字回答列表">
                {qs.text_answers.map((ans, i) => (
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
                </div>
                <div className="space-y-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                  {r.answers.length === 0 ? (
                    <p className="text-xs pt-2" style={{ color: "var(--text-muted)" }}>（無作答內容）</p>
                  ) : (
                    r.answers.map(a => {
                      const label = questionLabels.get(a.question_id) ?? "題目";
                      const val = a.answer_options.length
                        ? a.answer_options.join("、")
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
export default function SurveyDetailPage() {
  const params = useParams();
  const { can } = usePermissions();
  const id = params.id as string;

  const [survey, setSurvey] = useState<SurveyOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [viewStats, setViewStats] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [emailCopy, setEmailCopy] = useState(false);
  const answerDraft = useMemo(() => answers, [answers]);
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
  const { clearDraft, flushDraft } = useDraftAutosave({
    key: `surveys:${id}:response`,
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

  const load = useCallback(() => {
    setLoading(true);
    // 未登入者改用公開端點（僅開放未登入填答的問卷可取得）
    const loggedIn = typeof window !== "undefined" && Boolean(localStorage.getItem("user_id"));
    const fetcher = loggedIn ? surveysApi.get(id) : surveysApi.getPublic(id);
    fetcher
      .then(s => {
        setSurvey(s);
        // 初始化答案狀態
        const init: AnswerMap = {};
        s.questions.forEach(q => {
          if (!DISPLAY_TYPES.has(q.question_type)) init[q.id] = { text: "", options: [] };
        });
        setAnswers(init);
      })
      .catch(() => toast.error("載入問卷失敗"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (survey) recordRecent({ kind: "survey", id: survey.id, title: survey.title, href: `/surveys/${encodeURIComponent(survey.title)}` });
  }, [survey]);

  const submit = async () => {
    if (!survey) return;
    // 驗證必填（略過顯示條件未成立的題目）
    for (const q of survey.questions) {
      if (DISPLAY_TYPES.has(q.question_type)) continue;
      if (hiddenIds.has(q.id)) continue;
      if (!q.is_required) continue;
      const ans = answers[q.id];
      const hasText = ans?.text.trim();
      const hasOptions = ans?.options.length > 0;
      if (!hasText && !hasOptions) {
        toast.error(`請填答「${q.question_text.slice(0, 30)}」`);
        return;
      }
    }

    // 排序題額外驗證項數
    for (const q of survey.questions) {
      if (q.question_type !== "ranking" || hiddenIds.has(q.id)) continue;
      const chosen = answers[q.id]?.options ?? [];
      const minN = q.min_value ?? (q.is_required ? 1 : 0);
      const maxN = q.max_value ?? q.options.length;
      if (q.is_required && chosen.length < Math.max(minN, 1)) {
        toast.error(`「${q.question_text.slice(0, 20)}」至少需排序 ${Math.max(minN, 1)} 項`);
        return;
      }
      if (chosen.length > 0 && chosen.length < minN) {
        toast.error(`「${q.question_text.slice(0, 20)}」至少需排序 ${minN} 項`);
        return;
      }
      if (chosen.length > maxN) {
        toast.error(`「${q.question_text.slice(0, 20)}」最多只能排序 ${maxN} 項`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const anon_token = survey.is_anonymous ? crypto.randomUUID() : undefined;
      await surveysApi.submit(id, {
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
      });
      clearDraft();
      toast.success("填答成功，感謝您的參與！");
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
    } else if (survey.status === "draft") {
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
  if (!survey) return <div className="py-20 text-center text-sm" style={{ color: "var(--text-muted)" }}>問卷不存在</div>;

  const isAdmin = can("survey:manage");
  const isOpen = survey.status === "open";
  const questionCount = survey.questions.filter(q => !DISPLAY_TYPES.has(q.question_type)).length;

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
            {survey.description && (
              <p className="text-sm mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                {survey.description}
              </p>
            )}
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
              href={`/surveys/${encodeURIComponent(survey.title)}/edit`}
              className="btn btn-ghost text-xs">
              編輯題目
            </Link>
          )}
          {isAdmin && (survey.status === "draft" || survey.status === "open") && (
            <button
              onClick={toggleStatus}
              disabled={opening || closing}
              className="btn btn-ghost text-xs"
              style={survey.status === "open" ? { color: "var(--danger)" } : {}}>
              {opening ? "開放中…" : closing ? "關閉中…" : survey.status === "draft" ? "開放填答" : "關閉問卷"}
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

      {/* 統計 / 填答 */}
      {isAdmin && viewStats ? (
        <StatsView surveyId={id} />
      ) : submitted ? (
        <div className="card p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
            style={{ background: "var(--success-dim)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" style={{ color: "var(--success)" }} aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>感謝您的填答！</p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>您的回應已成功提交。</p>
          <Link href="/surveys" className="btn btn-ghost inline-flex">返回問卷列表</Link>
        </div>
      ) : !isOpen ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>此問卷目前不開放填答</p>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-4">
          {survey.questions.map((q) => {
            if (hiddenIds.has(q.id)) return null;
            const isDisplay = DISPLAY_TYPES.has(q.question_type);
            return (
            <div key={q.id} className={isDisplay ? "py-2 space-y-3" : "card p-5 space-y-3"}>
              <div className="flex items-start gap-2">
                {!isDisplay && (
                  <span className="text-xs font-bold mt-0.5 flex-shrink-0"
                    style={{ color: "var(--primary)" }}>Q{numberMap.get(q.id)}</span>
                )}
                <div className="flex-1">
                  <p className={isDisplay ? "sr-only" : "text-sm font-medium"} style={{ color: "var(--text-primary)" }}>
                    {q.question_text}
                    {q.is_required && <span className="ml-1" style={{ color: "var(--danger)" }}>*</span>}
                  </p>
                </div>
              </div>
              {q.image_url && q.question_type !== "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={uploadUrl(q.image_url)} alt=""
                  className="max-h-72 w-full rounded-lg object-contain"
                  style={{ border: "1px solid var(--border)" }} />
              )}
              <QuestionInput
                question={q}
                value={answers[q.id] ?? { text: "", options: [] }}
                onChange={val => setAnswers(prev => ({ ...prev, [q.id]: val }))}
              />
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
              {submitting ? "提交中…" : "提交填答"}
            </button>
          </div>
          {survey.is_anonymous && (
            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              此為匿名問卷，您的身份不會與填答內容關聯
            </p>
          )}
        </form>
      )}

      {shareOpen && <ShareModal title={survey.title} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
