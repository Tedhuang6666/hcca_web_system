"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Eye,
  Lock,
  Plus,
  RefreshCcw,
  Trash2,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  webhooksApi,
  type WebhookDeliveryOut,
  type WebhookSubscriptionCreatedResponse,
  type WebhookSubscriptionOut,
} from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--warning)",
  succeeded: "var(--success)",
  failed: "var(--danger)",
  dead: "var(--danger)",
};

export default function WebhooksPage() {
  const { isAdmin } = usePermissions();
  const [subs, setSubs] = useState<WebhookSubscriptionOut[]>([]);
  const [onlyActive, setOnlyActive] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("");
  const [maxRetries, setMaxRetries] = useState(7);

  const [created, setCreated] = useState<WebhookSubscriptionCreatedResponse | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<{
    sub: WebhookSubscriptionOut;
    items: WebhookDeliveryOut[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await webhooksApi.list(onlyActive);
      setSubs(rows);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取失敗");
    }
  }, [onlyActive]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const onCreate = async () => {
    const eventList = events
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim() || !url.trim() || eventList.length === 0) {
      toast.error("name / url / events 都必填");
      return;
    }
    setBusy(true);
    try {
      const r = await webhooksApi.create({
        name: name.trim(),
        url: url.trim(),
        events: eventList,
        max_retries: maxRetries,
      });
      setCreated(r);
      setName("");
      setUrl("");
      setEvents("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (sub: WebhookSubscriptionOut) => {
    setBusy(true);
    try {
      await webhooksApi.update(sub.id, { is_active: !sub.is_active });
      toast.success(sub.is_active ? "已停用" : "已啟用");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (sub: WebhookSubscriptionOut) => {
    if (!window.confirm(`刪除訂閱「${sub.name}」？已投遞紀錄會保留。`)) return;
    setBusy(true);
    try {
      await webhooksApi.remove(sub.id);
      toast.success("已刪除");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  const showDeliveries = async (sub: WebhookSubscriptionOut) => {
    setBusy(true);
    try {
      const items = await webhooksApi.deliveries(sub.id, 100);
      setDeliveriesFor({ sub, items });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取投遞紀錄失敗");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已複製");
    } catch {
      toast.error("複製失敗");
    }
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            需要超級管理員權限
          </h1>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <Webhook size={14} aria-hidden />
            Webhooks（外部系統推送）
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Webhooks</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
            訂閱平台事件並 HTTP POST 到外部 URL。**HMAC signing secret 只在建立時顯示一次**。
            投遞失敗會自動重試（指數退避）。
          </p>
        </div>
        <div className="flex gap-2">
          <label className="inline-flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            只看 active
          </label>
          <button type="button" className="btn btn-ghost" onClick={load}>
            <RefreshCcw size={16} aria-hidden />
            重新整理
          </button>
        </div>
      </header>

      <section
        className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">新增訂閱</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_2fr_2fr_1fr_auto]">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名稱"
            className="input"
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-server.example.com/webhook"
            className="input font-mono text-xs"
          />
          <input
            type="text"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            placeholder="events（逗號分隔，例：document.approved,regulation.published）"
            className="input font-mono text-xs"
          />
          <input
            type="number"
            min={0}
            max={20}
            value={maxRetries}
            onChange={(e) => setMaxRetries(Number(e.target.value))}
            className="input"
            title="max_retries"
          />
          <button type="button" className="btn btn-primary" onClick={onCreate} disabled={busy}>
            <Plus size={14} aria-hidden />
            建立
          </button>
        </div>
      </section>

      {created && (
        <section
          className="mb-4 rounded-lg border p-4"
          style={{
            background: "var(--warning-dim)",
            borderColor: "var(--warning-border)",
            color: "var(--warning)",
          }}
          role="status">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">
                訂閱 {created.subscription.name} 已建立。請立即複製 HMAC signing secret：
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-[var(--bg-surface)] px-2 py-1 font-mono text-xs">
                  {created.signing_secret}
                </code>
                <button
                  type="button"
                  className="btn-sm btn-primary"
                  onClick={() => copy(created.signing_secret)}>
                  <Copy size={12} aria-hidden />
                  複製
                </button>
                <button
                  type="button"
                  className="btn-sm btn-ghost"
                  onClick={() => setCreated(null)}>
                  我已保存，關閉
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section
        className="overflow-hidden rounded-lg border bg-[var(--bg-surface)]"
        style={{ borderColor: "var(--border)" }}>
        {subs.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">尚無訂閱。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--border)] bg-[var(--bg-base)]">
                <th className="px-3 py-2 text-left">名稱</th>
                <th className="px-3 py-2 text-left">URL</th>
                <th className="px-3 py-2 text-left">events</th>
                <th className="px-3 py-2 text-right">retries</th>
                <th className="px-3 py-2 text-center">狀態</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-[var(--border)]"
                  style={{ opacity: s.is_active ? 1 : 0.5 }}>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 break-all font-mono text-[10px]">{s.url}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{s.events.join(", ")}</td>
                  <td className="px-3 py-2 text-right">{s.max_retries}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      className="btn-sm btn-ghost"
                      onClick={() => onToggle(s)}
                      disabled={busy}>
                      {s.is_active ? "啟用中" : "已停用"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="btn-sm btn-ghost mr-1"
                      onClick={() => showDeliveries(s)}>
                      <Eye size={12} aria-hidden />
                      投遞
                    </button>
                    <button
                      type="button"
                      className="btn-sm btn-danger"
                      onClick={() => onDelete(s)}
                      disabled={busy}>
                      <Trash2 size={12} aria-hidden />
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {deliveriesFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--bg-overlay)" }}
          onClick={() => setDeliveriesFor(null)}
          role="dialog"
          aria-modal="true">
          <div
            className="max-h-[80vh] w-full max-w-4xl overflow-auto rounded-lg border p-5 shadow-xl"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
              投遞紀錄 · {deliveriesFor.sub.name}
            </h3>
            {deliveriesFor.items.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">尚無投遞。</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="text-[var(--text-secondary)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-1 text-left">event</th>
                    <th className="py-1 text-left">狀態</th>
                    <th className="py-1 text-right">嘗試</th>
                    <th className="py-1 text-right">HTTP</th>
                    <th className="py-1 text-left">錯誤</th>
                    <th className="py-1 text-right">最後嘗試</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveriesFor.items.map((d) => (
                    <tr key={d.id} className="border-b border-[var(--border)]">
                      <td className="py-1 font-mono">{d.event_type}</td>
                      <td className="py-1">
                        <span style={{ color: STATUS_COLOR[d.status] ?? "inherit" }}>
                          {d.status}
                        </span>
                      </td>
                      <td className="py-1 text-right">{d.attempt_count}</td>
                      <td className="py-1 text-right">{d.response_status ?? "—"}</td>
                      <td className="py-1 max-w-[16rem] truncate" title={d.error_message ?? ""}>
                        {d.error_message ?? "—"}
                      </td>
                      <td className="py-1 text-right">
                        {d.last_attempted_at
                          ? new Date(d.last_attempted_at).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeliveriesFor(null)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
