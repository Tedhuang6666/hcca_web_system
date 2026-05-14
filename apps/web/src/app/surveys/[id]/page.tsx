"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { surveysApi, ApiError } from "@/lib/api";
import type { SurveyOut, SurveyQuestionOut, SurveyStats } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

const DISPLAY_TYPES = new Set(["section_text", "page_break", "image", "video"]);

/* ── 各題型的填答元件 ─────────────────────────────────────────────────────── */
function QuestionInput({
  question, value, onChange,
}: {
  question: SurveyQuestionOut;
  value: { text: string; options: string[] };
  onChange: (val: { text: string; options: string[] }) => void;
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
    return (
      <figure className="space-y-2">
        {placeholder && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={placeholder} alt={question.question_text} className="max-h-80 w-full rounded-lg object-contain" />
        )}
        <figcaption className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>
          {question.question_text}
        </figcaption>
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
    return (
      <input
        value={value.text}
        onChange={e => onChange({ ...value, text: e.target.value })}
        placeholder={placeholder ?? "請輸入…"}
        className="input"
      />
    );
  }
  if (type === "textarea") {
    return (
      <textarea
        value={value.text}
        onChange={e => onChange({ ...value, text: e.target.value })}
        rows={3}
        placeholder={placeholder ?? "請輸入…"}
        className="input resize-y"
      />
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
    return (
      <div className="space-y-2">
        {options.map(opt => {
          const checked = value.options.includes(opt);
          return (
            <label key={opt} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl transition-all"
              style={{
                background: checked ? "var(--primary-dim)" : "var(--bg-elevated)",
                border: `1px solid ${checked ? "var(--border-strong)" : "var(--border)"}`,
              }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? value.options.filter(o => o !== opt)
                    : [...value.options, opt];
                  onChange({ ...value, options: next });
                }}
                className="accent-sky-400"
              />
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>{opt}</span>
            </label>
          );
        })}
      </div>
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
          {minV} 最低 → {maxV} 最高
        </span>
      </div>
    );
  }
  return null;
}

/* ── 統計視圖（管理員） ───────────────────────────────────────────────────── */
function StatsView({ surveyId }: { surveyId: string }) {
  const [stats, setStats] = useState<SurveyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartTypes, setChartTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    surveysApi.stats(surveyId)
      .then(setStats)
      .catch(() => toast.error("載入統計失敗"))
      .finally(() => setLoading(false));
  }, [surveyId]);

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
              <span style={{ color: "var(--text-muted)" }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 px-5 py-3 rounded-xl"
        style={{ background: "var(--info-dim)", border: "1px solid rgba(37,99,235,0.2)" }}>
        <p className="text-sm" style={{ color: "var(--info)" }}>
          共 <strong>{stats.total_responses}</strong> 份回應
        </p>
      </div>

      {stats.questions.map(qs => (
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
  const [answers, setAnswers] = useState<Record<string, { text: string; options: string[] }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [viewStats, setViewStats] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    surveysApi.get(id)
      .then(s => {
        setSurvey(s);
        // 初始化答案狀態
        const init: Record<string, { text: string; options: string[] }> = {};
        s.questions.forEach(q => {
          if (!DISPLAY_TYPES.has(q.question_type)) init[q.id] = { text: "", options: [] };
        });
        setAnswers(init);
      })
      .catch(() => toast.error("載入問卷失敗"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!survey) return;
    // 驗證必填
    for (const q of survey.questions) {
      if (DISPLAY_TYPES.has(q.question_type)) continue;
      if (!q.is_required) continue;
      const ans = answers[q.id];
      const hasText = ans?.text.trim();
      const hasOptions = ans?.options.length > 0;
      if (!hasText && !hasOptions) {
        toast.error(`請填答「${q.question_text.slice(0, 30)}」`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const anon_token = survey.is_anonymous ? crypto.randomUUID() : undefined;
      await surveysApi.submit(id, {
        answers: survey.questions
          .filter(q => !DISPLAY_TYPES.has(q.question_type))
          .map(q => ({
            question_id: q.id,
            answer_text: answers[q.id]?.text || undefined,
            answer_options: answers[q.id]?.options,
          })),
        anon_token,
      });
      toast.success("填答成功，感謝您的參與！");
      setSubmitted(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("您已填答過此問卷");
      } else {
        toast.error(e instanceof ApiError ? e.message : "提交失敗");
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
      } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
      finally { setClosing(false); }
    } else if (survey.status === "draft") {
      setOpening(true);
      try {
        await surveysApi.open(id);
        toast.success("問卷已開放填答");
        load();
      } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
      finally { setOpening(false); }
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
          style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }} />
        <p className="text-sm">載入中…</p>
      </div>
    );
  }
  if (!survey) return <div className="py-20 text-center text-sm" style={{ color: "var(--text-muted)" }}>問卷不存在</div>;

  const isAdmin = can("survey:manage");
  const isOpen = survey.status === "open";

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
        {/* 管理員操作 */}
        {isAdmin && (
          <div className="flex gap-2 flex-shrink-0">
            {(survey.status === "draft" || survey.status === "open") && (
              <button
                onClick={toggleStatus}
                disabled={opening || closing}
                className="btn btn-ghost text-xs"
                style={survey.status === "open" ? { color: "var(--danger)" } : {}}>
                {opening ? "開放中…" : closing ? "關閉中…" : survey.status === "draft" ? "開放填答" : "關閉問卷"}
              </button>
            )}
            <button
              onClick={() => setViewStats(v => !v)}
              className="btn btn-ghost text-xs"
              style={viewStats ? { color: "var(--primary)" } : {}}>
              {viewStats ? "填答表單" : "查看統計"}
            </button>
          </div>
        )}
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
        <span>{survey.questions.filter(q => !DISPLAY_TYPES.has(q.question_type)).length} 道題目</span>
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
          {survey.questions.map((q, idx) => {
            const isDisplay = DISPLAY_TYPES.has(q.question_type);
            return (
            <div key={q.id} className={isDisplay ? "py-2 space-y-3" : "card p-5 space-y-3"}>
              <div className="flex items-start gap-2">
                {!isDisplay && (
                  <span className="text-xs font-bold mt-0.5 flex-shrink-0"
                    style={{ color: "var(--primary)" }}>Q{idx + 1}</span>
                )}
                <div className="flex-1">
                  <p className={isDisplay ? "sr-only" : "text-sm font-medium"} style={{ color: "var(--text-primary)" }}>
                    {q.question_text}
                    {q.is_required && <span className="ml-1" style={{ color: "var(--danger)" }}>*</span>}
                  </p>
                </div>
              </div>
              <QuestionInput
                question={q}
                value={answers[q.id] ?? { text: "", options: [] }}
                onChange={val => setAnswers(prev => ({ ...prev, [q.id]: val }))}
              />
            </div>
            );
          })}

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
    </div>
  );
}
