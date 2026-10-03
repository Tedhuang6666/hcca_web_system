"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiErrorMessage, systemApi, type ErrorCategory, type RecentErrorItem } from "@/lib/api";

type ErrorTone = "danger" | "warning" | "neutral";

const ERROR_CATEGORY: Record<ErrorCategory, { label: string; tone: ErrorTone; hint: string }> = {
  db: { label: "資料庫", tone: "danger", hint: "檢查資料庫連線與查詢錯誤。" },
  unhandled: { label: "未處理例外", tone: "danger", hint: "展開追蹤並檢查程式錯誤。" },
  client: { label: "前端錯誤", tone: "danger", hint: "檢查瀏覽器堆疊與發生頁面。" },
  redis: { label: "Redis / 快取", tone: "warning", hint: "檢查快取服務狀態。" },
  timeout: { label: "逾時", tone: "warning", hint: "可搭配下方慢查詢紀錄判斷負載。" },
  validation: { label: "請求驗證", tone: "neutral", hint: "檢查前端 payload 與 API schema。" },
  http: { label: "HTTP 錯誤", tone: "neutral", hint: "查看狀態碼與請求路徑。" },
};

const ERROR_TONE_CLASS: Record<ErrorTone, string> = {
  danger: "border-[var(--danger-border)] bg-[var(--danger-dim)] text-[var(--danger)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-dim)] text-[var(--warning)]",
  neutral: "border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-muted)]",
};

function ErrorRow({ item }: { item: RecentErrorItem }) {
  const meta = ERROR_CATEGORY[item.category] ?? ERROR_CATEGORY.unhandled;

  return (
    <article className="rounded-md border p-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${ERROR_TONE_CLASS[meta.tone]}`}>
          {meta.label}
        </span>
        <span className="font-mono text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {item.exc_type}
        </span>
        {item.status_code > 0 && <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{item.status_code}</span>}
        {item.occurrences > 1 && <span className="text-xs" style={{ color: "var(--text-muted)" }}>×{item.occurrences}</span>}
        <time className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
          {new Date(item.last_seen * 1000).toLocaleString()}
        </time>
      </div>
      <p className="mt-1.5 break-all font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
        <span style={{ color: "var(--text-muted)" }}>{item.method}</span> {item.path}
        <span className="ml-2" style={{ color: "var(--text-muted)" }}>錯誤代碼 {item.error_id}</span>
        {item.request_id && <span className="ml-2" style={{ color: "var(--text-muted)" }}>請求 {item.request_id}</span>}
      </p>
      {(item.client_ip || item.user_agent || item.source) && (
        <p className="mt-1 break-all text-xs" style={{ color: "var(--text-muted)" }}>
          {item.client_ip && <>IP：{item.client_ip}　</>}
          {item.source && <>來源：{item.source === "redis" ? "報告事件" : "即時緩衝"}　</>}
          {item.user_agent && <>UA：{item.user_agent}</>}
        </p>
      )}
      {item.message && <p className="mt-1 break-words text-sm" style={{ color: "var(--text-primary)" }}>{item.message}</p>}
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{meta.hint}</p>
      {item.traceback_head && (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            展開追蹤資訊
          </summary>
          <pre className="max-h-72 overflow-auto rounded-md p-2 font-mono text-[11px] leading-snug" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
            {item.traceback_head}
          </pre>
        </details>
      )}
    </article>
  );
}

export default function SystemRecentErrorsPanel({
  initialItems,
}: {
  initialItems: RecentErrorItem[];
}) {
  const confirm = useConfirm();
  const [items, setItems] = useState<RecentErrorItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupResult, setLookupResult] = useState<RecentErrorItem | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await systemApi.recentErrors(50);
      setItems(data.items);
    } catch (error) {
      toast.error(apiErrorMessage(error, "載入錯誤紀錄失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const clear = async () => {
    if (!(await confirm({
      title: "清空錯誤緩衝？",
      description: "近期錯誤紀錄會被移除，無法復原。",
      confirmLabel: "清空紀錄",
      danger: true,
    }))) return;
    try {
      const result = await systemApi.clearErrors();
      toast.success(`已清空 ${result.cleared} 筆錯誤`);
      setItems([]);
      setLookupResult(null);
    } catch (error) {
      toast.error(apiErrorMessage(error, "清空失敗"));
    }
  };

  const lookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = lookupCode.trim();
    if (!code) {
      toast.warning("請輸入錯誤代碼");
      return;
    }
    setLookupLoading(true);
    try {
      setLookupResult(await systemApi.errorById(code));
    } catch (error) {
      setLookupResult(null);
      toast.error(apiErrorMessage(error, "查詢失敗"));
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <section className="rounded-md border" style={{ borderColor: "var(--border)" }}>
      <details>
        <summary className="flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span>
            <span className="block text-sm font-semibold" style={{ color: "var(--text-primary)" }}>即時錯誤緩衝</span>
            <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
              最近 {items.length} 筆；服務重新啟動後會清空
            </span>
          </span>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>展開查詢與清理</span>
        </summary>
        <div className="space-y-3 border-t p-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="btn btn-ghost text-xs">
              {loading ? "載入中…" : "重新整理"}
            </button>
            <button type="button" onClick={() => void clear()} disabled={items.length === 0} className="btn-sm btn-danger-ghost">
              <Trash2 size={13} aria-hidden /> 清空緩衝
            </button>
          </div>
          <form onSubmit={lookup} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="observability-error-code" className="shrink-0 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              錯誤代碼
            </label>
            <input
              id="observability-error-code"
              value={lookupCode}
              onChange={(event) => setLookupCode(event.target.value)}
              placeholder="貼上使用者回報的錯誤代碼"
              className="input min-w-0 flex-1 font-mono"
            />
            <button type="submit" disabled={lookupLoading} className="btn btn-primary">
              <Search size={14} aria-hidden /> {lookupLoading ? "查詢中…" : "查詢"}
            </button>
          </form>
          {lookupResult && <ErrorRow item={lookupResult} />}
          {items.length === 0 ? (
            <p className="py-4 text-center text-sm" role={loading ? "status" : undefined} style={{ color: "var(--text-muted)" }}>
              {loading ? "載入中…" : "目前沒有錯誤紀錄。"}
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => <ErrorRow key={`${item.error_id}-${item.first_seen}`} item={item} />)}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
