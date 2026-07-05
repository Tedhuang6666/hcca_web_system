"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { activitiesApi, surveysApi, orgsApi, usersApi, apiErrorMessage } from "@/lib/api";
import type { SurveyQuestionBody, OrgRead } from "@/lib/api";
import type { Activity, SurveyOut, SurveyQuestionOut, QuestionType, UserSummary } from "@/lib/types";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import UserPicker from "@/components/surveys/UserPicker";
import ActivitySelect from "@/components/activities/ActivitySelect";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";

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
  q, index, total, others, busy, onSave, onDelete, onMove,
}: {
  q: SurveyQuestionOut;
  index: number;
  total: number;
  others: SurveyQuestionOut[];
  busy: boolean;
  onSave: (id: string, body: SurveyQuestionBody) => Promise<void>;
  onDelete: (id: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const [text, setText] = useState(q.question_text);
  const [required, setRequired] = useState(q.is_required);
  const [optionsText, setOptionsText] = useState(q.options.join("\n"));
  const [minValue, setMinValue] = useState(q.min_value ?? 1);
  const [maxValue, setMaxValue] = useState(q.max_value ?? 5);
  const [minLabel, setMinLabel] = useState(q.min_label ?? "");
  const [maxLabel, setMaxLabel] = useState(q.max_label ?? "");
  const [minLength, setMinLength] = useState(q.min_length?.toString() ?? "");
  const [maxLength, setMaxLength] = useState(q.max_length?.toString() ?? "");
  const [rule, setRule] = useState<string>(q.validation_rule ?? "");
  const [placeholder, setPlaceholder] = useState(q.placeholder ?? "");
  const [imageUrl, setImageUrl] = useState(q.image_url ?? "");
  const [exclusiveOpts, setExclusiveOpts] = useState<string[]>(q.option_config?.exclusive ?? []);
  const [otherOpts, setOtherOpts] = useState<string[]>(q.option_config?.other ?? []);
  const [rules, setRules] = useState<CondRule[]>(
    (q.condition?.rules ?? []).map(r => ({
      question_id: r.question_id, operator: r.operator, value: r.value, connector: r.connector,
    })),
  );
  const [saving, setSaving] = useState(false);

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
  const fileRef = useRef<HTMLInputElement>(null);

  const isMultiple = q.question_type === "multiple";
  const isRanking = q.question_type === "ranking";
  const isChoice = q.question_type === "single" || isMultiple || isRanking;
  const isRating = q.question_type === "rating";
  const isText = q.question_type === "text" || q.question_type === "textarea";
  const isImage = q.question_type === "image";
  const isVideo = q.question_type === "video";

  // 從 optionsText 拆出實際選項清單，供「互斥／其他」標記面板使用
  const parsedOptions = optionsText.split("\n").map(s => s.trim()).filter(Boolean);
  const toggleExclusive = (opt: string) =>
    setExclusiveOpts(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);
  const toggleOther = (opt: string) =>
    setOtherOpts(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("請選擇圖片檔案"); return; }
    try {
      const { url } = await surveysApi.uploadImage(file);
      setImageUrl(url);
      toast.success("圖片已上傳，記得儲存此題");
    } catch (e) {
      toast.error(apiErrorMessage(e, "上傳失敗"));
    }
  };

  const save = async () => {
    const opts = isChoice ? parsedOptions : [];
    if (isChoice && opts.length < 2) { toast.error("選擇題至少需 2 個選項"); return; }
    if (isRanking && maxValue > opts.length) {
      toast.error("排序最多項數不可大於選項總數"); return;
    }
    if (isRanking && minValue > maxValue) {
      toast.error("最少項數不可大於最多項數"); return;
    }
    setSaving(true);
    const body: SurveyQuestionBody = { question_text: text, is_required: required };
    if (isChoice) body.options = opts;
    if (isMultiple) {
      const exclusive = exclusiveOpts.filter(o => opts.includes(o));
      const other = otherOpts.filter(o => opts.includes(o));
      body.option_config = (exclusive.length || other.length) ? { exclusive, other } : null;
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
    if (isImage || (!DISPLAY_TYPES.has(q.question_type))) body.image_url = imageUrl;
    const validRules = rules.filter(r => r.question_id);
    body.condition = validRules.length ? { rules: validRules } : null;
    try {
      await onSave(q.id, body);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold px-2 py-0.5 rounded"
          style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
          {typeLabel(q.question_type)}
        </span>
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

      <div>
        <Label>{isImage ? "圖片說明（選填）" : DISPLAY_TYPES.has(q.question_type) ? "區塊文字" : "題目文字"}</Label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
          className="input resize-y" />
      </div>

      {!DISPLAY_TYPES.has(q.question_type) && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)}
            className="accent-sky-400" />
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>必填</span>
        </label>
      )}

      {isChoice && (
        <div>
          <Label>選項（每行一個，至少 2 個）</Label>
          <textarea value={optionsText} onChange={e => setOptionsText(e.target.value)} rows={3}
            className="input resize-y" placeholder={"選項一\n選項二"} />
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

      {(isImage || !DISPLAY_TYPES.has(q.question_type)) && (
        <div>
          <Label>{isImage ? "圖片" : "附加圖片（選填）"}</Label>
          {imageUrl && (
            <div className="relative inline-block mb-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploadUrl(imageUrl)} alt="預覽" className="max-h-32 rounded-lg"
                style={{ border: "1px solid var(--border)" }} />
              <button type="button" onClick={() => setImageUrl("")}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs"
                style={{ background: "var(--danger)", color: "white" }} aria-label="移除">×</button>
            </div>
          )}
          <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-ghost w-full text-xs">
            {imageUrl ? "更換圖片" : "上傳圖片"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
        </div>
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
                  ? src.options : [];
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

      <button type="button" onClick={save} disabled={saving || busy}
        className="btn btn-primary w-full text-sm" aria-busy={saving}>
        {saving ? "儲存中…" : "儲存此題"}
      </button>
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [activityId, setActivityId] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [newType, setNewType] = useState<QuestionType>("text");
  const [newText, setNewText] = useState("");
  const [newOptions, setNewOptions] = useState("");
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
        setAllowedDomains(s.allowed_domains.join("\n"));
        setAllowedOrgIds(s.allowed_org_ids);
        if (s.allowed_user_ids.length > 0) {
          usersApi.listByIds(s.allowed_user_ids)
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

  const saveQuestion = async (questionId: string, body: SurveyQuestionBody) => {
    try {
      await surveysApi.updateQuestion(questionId, body);
      toast.success("題目已更新");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
      throw e;
    }
  };

  const deleteQuestion = async (questionId: string) => {
    if (!confirm("確定刪除此題？該題已有的回答也會一併移除。")) return;
    setBusy(true);
    try {
      await surveysApi.deleteQuestion(questionId);
      toast.success("題目已刪除");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    } finally { setBusy(false); }
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!survey) return;
    const target = index + dir;
    if (target < 0 || target >= survey.questions.length) return;
    const ordered = [...survey.questions];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
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

  const addQuestion = async () => {
    if (!survey) return;
    const isImg = newType === "image";
    const isChoice = newType === "single" || newType === "multiple" || newType === "ranking";
    if (!isImg && !newText.trim()) { toast.error("請輸入題目或區塊文字"); return; }
    const opts = newOptions.split("\n").map(s => s.trim()).filter(Boolean);
    if (isChoice && opts.length < 2) { toast.error("選擇題至少需 2 個選項"); return; }
    if (isImg) { toast.error("圖片題請先新增其他題型，再於題目卡上傳圖片"); return; }
    setBusy(true);
    try {
      const body: SurveyQuestionBody & { question_text: string; question_type: string } = {
        question_text: newText.trim() || "（未命名）",
        question_type: newType,
        options: isChoice ? opts : [],
        order_index: survey.questions.length,
      };
      if (newType === "ranking") {
        body.min_value = 1;
        body.max_value = opts.length;
      }
      await surveysApi.addQuestion(survey.id, body);
      setNewText("");
      setNewOptions("");
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
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          題目（{survey.questions.length}）— 可用箭頭調整順序
        </h3>
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
          />
        ))}
      </div>

      {/* 新增題目 */}
      <div className="card p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>新增題目</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>題型</Label>
            <select value={newType} onChange={e => setNewType(e.target.value as QuestionType)} className="input">
              {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <Label>題目 / 區塊文字</Label>
          <textarea value={newText} onChange={e => setNewText(e.target.value)} rows={2}
            className="input resize-y" placeholder="請輸入題目…" />
        </div>
        {needsOptions && (
          <div>
            <Label>選項（每行一個，至少 2 個）</Label>
            <textarea value={newOptions} onChange={e => setNewOptions(e.target.value)} rows={3}
              className="input resize-y" placeholder={"選項一\n選項二"} />
          </div>
        )}
        <button onClick={addQuestion} disabled={busy} className="btn btn-primary w-full text-sm">
          加入題目
        </button>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          新增後可在上方題目卡設定評分、驗證規則、圖片與顯示條件。
        </p>
      </div>
    </div>
  );
}
