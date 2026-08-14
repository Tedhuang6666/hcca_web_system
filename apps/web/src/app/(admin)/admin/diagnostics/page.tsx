"use client";

import { useCallback, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Inbox,
  Lock,
  Mail,
  RefreshCcw,
  Server,
  GitCommitHorizontal,
  Wifi,
  XCircle,
} from "lucide-react";

import { usePermissions } from "@/hooks/usePermissions";
import { useResilientPoll } from "@/hooks/useResilientPoll";
import { ApiError, systemApi, type SystemDiagnostics, type VersionStatus } from "@/lib/api";
import { isFatalApiStatus } from "@/lib/polling";

const POLL_MS = 10_000;

function fmtUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小時`;
  if (h > 0) return `${h} 小時 ${m} 分`;
  if (m > 0) return `${m} 分 ${s % 60} 秒`;
  return `${s} 秒`;
}

// email outbox 狀態 → 顯示標籤與語意色
const OUTBOX_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  sent: { label: "已送出", tone: "ok" },
  queued: { label: "佇列中", tone: "muted" },
  scheduled: { label: "已排程", tone: "muted" },
  draft: { label: "草稿", tone: "muted" },
  retrying: { label: "重試中", tone: "warn" },
  partial: { label: "部分失敗", tone: "warn" },
  failed: { label: "失敗", tone: "bad" },
  dead: { label: "已退信(dead)", tone: "bad" },
  cancelled: { label: "已取消", tone: "muted" },
};

const TONE_COLOR: Record<string, string> = {
  ok: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--danger)",
  muted: "var(--text-muted)",
};

function HealthBadge({ ok, detail }: { ok: boolean; detail?: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        background: ok ? "var(--success-dim)" : "var(--danger-dim)",
        color: ok ? "var(--success)" : "var(--danger)",
      }}>
      {ok ? <CheckCircle2 size={13} aria-hidden /> : <XCircle size={13} aria-hidden />}
      {ok ? "正常" : (detail ?? "異常")}
    </span>
  );
}

function VersionStatus({ status }: { status: VersionStatus["sync_status"] }) {
  const content = {
    current: { label: "版本一致", className: "bg-[var(--success-dim)] text-[var(--success)]" },
    outdated: { label: "等待部署", className: "bg-[var(--warning-dim)] text-[var(--warning)]" },
    unknown: { label: "無法確認", className: "bg-[var(--bg-hover)] text-[var(--text-muted)]" },
  }[status];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${content.className}`}>{content.label}</span>;
}

export default function DiagnosticsPage() {
  const { isAdmin } = usePermissions();
  const [data, setData] = useState<SystemDiagnostics | null>(null);
  const [version, setVersion] = useState<VersionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([systemApi.diagnostics(), systemApi.version()]);
      setData(d);
      setVersion(v);
      setError(null);
      setUpdatedAt(Date.now());
      return "ok" as const;
    } catch (e) {
      if (e instanceof ApiError && isFatalApiStatus(e.status)) {
        setError(e.message);
        return "stop" as const;
      }
      throw e;
    }
  }, []);

  useResilientPoll(poll, { enabled: isAdmin, intervalMs: POLL_MS });

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card p-8 text-center">
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">需要超級管理員權限</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">系統診斷僅開放超級管理員檢視。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="text-[var(--primary)]" size={22} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">系統診斷</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          {updatedAt && <span>更新於 {new Date(updatedAt).toLocaleTimeString()}</span>}
          <button
            type="button"
            onClick={() => void poll()}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]">
            <RefreshCcw size={13} aria-hidden /> 立即重新整理
          </button>
        </div>
      </header>

      {error && (
        <div
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"
          style={{ background: "var(--danger-dim)", color: "var(--danger)" }}
          role="alert">
          <AlertTriangle size={15} aria-hidden /> 無法取得診斷資料：{error}
        </div>
      )}

      {!data ? (
        <section className="card p-8 text-center text-sm text-[var(--text-muted)]">載入中…</section>
      ) : (
        <>
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                  <GitCommitHorizontal size={15} aria-hidden /> 版本與部署狀態
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">大版本・主版本・實版本・功能版本・commit 次數</p>
              </div>
              {version && <VersionStatus status={version.sync_status} />}
            </div>
            {!version ? (
              <p className="text-sm text-[var(--text-muted)]">載入版本資訊中…</p>
            ) : (
              <div className="mt-5 space-y-4 text-sm">
                <div className="rounded-xl border border-[var(--primary)] bg-[var(--primary-dim)] p-4">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">系統版本</p>
                  <p className="mt-1 font-mono text-2xl font-bold tracking-wide text-[var(--text-primary)]">{version.runtime.app_version}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">前四段由 VERSION 管理；最後一段是 Git commit 總數。</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border)] p-4">
                    <p className="text-xs font-medium text-[var(--text-muted)]">目前運行的 API</p>
                    <p className="mt-2 font-mono text-base font-semibold text-[var(--text-primary)]">{version.runtime.commit?.slice(0, 12) ?? "尚無 Git commit"}</p>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">分支：{version.runtime.ref ?? "—"}</p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">建置時間：{version.runtime.built_at ? new Date(version.runtime.built_at).toLocaleString() : "—"}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] p-4">
                    <p className="text-xs font-medium text-[var(--text-muted)]">GitHub 最新推送（{version.github?.branch ?? "main"}）</p>
                    {version.github ? (
                      <>
                        <p className="mt-2 font-mono text-lg font-bold text-[var(--text-primary)]">{version.github.version ?? "版本計算中"}</p>
                        <a href={version.github.url ?? undefined} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-base font-semibold text-[var(--primary)] hover:underline">{version.github.short_sha}</a>
                        <p className="mt-2 line-clamp-2 text-xs text-[var(--text-secondary)]">{version.github.message}</p>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">推送時間：{version.github.pushed_at ? new Date(version.github.pushed_at).toLocaleString() : "—"}</p>
                      </>
                    ) : <p className="mt-2 text-sm text-[var(--danger)]">{version.github_error ?? "無法讀取 GitHub"}</p>}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--bg-hover)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                  {version.sync_status === "current" ? "目前 API 與 GitHub 最新推送為同一個 commit。" : version.sync_status === "outdated" ? "GitHub 已有新版本；請拉取新版映像並重啟 API、Web 服務。" : "目前為本機或舊版執行環境，重啟 dev.sh 或使用 GitHub Actions 建置的映像後即可比對。"}
                </div>
                <p className="text-xs text-[var(--text-muted)]">前端 commit：{process.env.NEXT_PUBLIC_BUILD_COMMIT?.slice(0, 12) ?? "本機啟動後自動取得"}</p>
              </div>
            )}
          </section>

          {/* 核心健康 */}
          <section className="card p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                  <Database size={15} aria-hidden /> 資料庫
                </span>
                <HealthBadge ok={data.db.ok} detail={data.db.detail} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                  <Server size={15} aria-hidden /> Redis
                </span>
                <HealthBadge ok={data.redis.ok} detail={data.redis.detail} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                  <Activity size={15} aria-hidden /> Celery
                </span>
                <HealthBadge ok={data.celery.ok} detail={data.celery.detail} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
              <span>版本 <code className="text-[var(--text-secondary)]">{data.version}</code></span>
              <span>運行時間 {fmtUptime(data.uptime_seconds)}</span>
              <span>Worker 數 {data.workers.length}</span>
            </div>
          </section>

          {/* 寄信積壓 + outbox */}
          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <Mail size={15} aria-hidden /> 寄信狀態
            </h2>
            <div
              className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{
                background: data.email_queue_pending > 0 ? "var(--warning-dim)" : "var(--bg-hover)",
                color: data.email_queue_pending > 0 ? "var(--warning)" : "var(--text-secondary)",
              }}>
              <Inbox size={15} aria-hidden />
              email 佇列待處理：<strong>{data.email_queue_pending}</strong>
              {data.email_queue_pending > 0 && "（確認 email-worker 已啟動且健康）"}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.email_outbox).length === 0 ? (
                <span className="text-xs text-[var(--text-muted)]">尚無寄信紀錄</span>
              ) : (
                Object.entries(data.email_outbox).map(([status, count]) => {
                  const meta = OUTBOX_LABELS[status] ?? { label: status, tone: "muted" as const };
                  return (
                    <span
                      key={status}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                      style={{ borderColor: "var(--border)", color: TONE_COLOR[meta.tone] }}>
                      {meta.label}
                      <strong className="text-[var(--text-primary)]">{count}</strong>
                    </span>
                  );
                })
              )}
            </div>
          </section>

          {/* Queue 積壓 */}
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Queue 積壓（broker backlog）</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.queue_depths.map((q) => (
                <div
                  key={q.name}
                  className="rounded-lg border border-[var(--border)] px-3 py-2"
                  style={{ background: q.pending > 0 ? "var(--bg-hover)" : "transparent" }}>
                  <div className="text-xs text-[var(--text-muted)]">{q.name}</div>
                  <div className="text-lg font-semibold text-[var(--text-primary)]">
                    {q.pending < 0 ? "—" : q.pending}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Workers */}
          {data.workers.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Worker 狀態</h2>
              <div className="space-y-1.5">
                {data.workers.map((w) => (
                  <div
                    key={w.name}
                    className="flex items-center justify-between rounded-md bg-[var(--bg-hover)] px-3 py-1.5 text-xs">
                    <code className="text-[var(--text-secondary)]">{w.name}</code>
                    <span className="text-[var(--text-muted)]">
                      active {w.active}・reserved {w.reserved}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* WebSocket 連線 */}
          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <Wifi size={15} aria-hidden /> WebSocket 連線
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "連線數", value: data.ws.total },
                { label: "房間數", value: data.ws.rooms },
                { label: "唯一 IP", value: data.ws.unique_ips },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-[var(--border)] px-3 py-2">
                  <div className="text-xs text-[var(--text-muted)]">{m.label}</div>
                  <div className="text-lg font-semibold text-[var(--text-primary)]">{m.value}</div>
                </div>
              ))}
            </div>
            {data.ws.per_room.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {data.ws.per_room.map((r) => (
                  <div
                    key={r.room}
                    className="flex items-center justify-between rounded-md bg-[var(--bg-hover)] px-3 py-1.5 text-xs">
                    <code className="text-[var(--text-secondary)]">{r.room}</code>
                    <span className="text-[var(--text-muted)]">{r.connections} 連線</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
