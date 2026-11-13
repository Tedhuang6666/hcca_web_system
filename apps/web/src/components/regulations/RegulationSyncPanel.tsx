"use client";

import { useEffect, useState } from "react";
import { orgsApi } from "@/lib/api/orgs";
import { regulationSyncApi } from "@/lib/api/regulation-sync";
import { apiErrorMessage } from "@/lib/api-helpers";
import { orgDisplayName } from "@/lib/orgs";
import type { OrgRead, RegulationSyncSourceUpdate, RegulationSyncStatusOut } from "@/lib/types";

const DEFAULT_FOLDER = "https://drive.google.com/drive/folders/1DUxeDy7MeN0c_CoeLfd0S7oRWKr6oGkw";
const STATUS_LABELS = { created: "新增", updated: "更新", unchanged: "一致", skipped: "略過", error: "待處理" };
const dateLabel = (value?: string | null) => value
  ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "尚未完成同步";

export default function RegulationSyncPanel({ onSynced }: { onSynced: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card p-4" aria-labelledby="regulation-sync-heading">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        aria-expanded={open} aria-controls="regulation-sync-settings" onClick={() => setOpen(!open)}>
        <span>
          <span id="regulation-sync-heading" className="block font-medium">法規來源同步</span>
          <span className="block text-sm" style={{ color: "var(--text-secondary)" }}>從議會 Drive 對照最新版、設定自動更新</span>
        </span>
        <span className="text-sm shrink-0">{open ? "收合" : "管理同步"}</span>
      </button>
      {open && <div id="regulation-sync-settings"><SourceSelector onSynced={onSynced} /></div>}
    </section>
  );
}

function SourceSelector({ onSynced }: { onSynced: () => void }) {
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    orgsApi.list({ active_only: true }).then((items) => {
      if (active) { setOrgs(items); if (items.length === 1) setOrgId(items[0].id); }
    }).catch((err: unknown) => { if (active) setError(apiErrorMessage(err, "無法載入組織，請重新開啟同步設定")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <div className="mt-4 space-y-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      <label className="block text-sm">所屬組織
        <select className="input mt-1 min-h-11 w-full" style={{ minHeight: 44 }} value={orgId} disabled={loading}
          onChange={(event) => setOrgId(event.target.value)}>
          <option value="">{loading ? "載入組織中…" : "請選擇要同步的組織"}</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{orgDisplayName(org, orgs)}</option>)}
        </select>
      </label>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {!loading && !error && !orgs.length && <p>尚無可用組織，請先建立組織。</p>}
      {orgId && <SourceSettings key={orgId} orgId={orgId} onSynced={onSynced} />}
    </div>
  );
}

function SourceSettings({ orgId, onSynced }: { orgId: string; onSynced: () => void }) {
  const [status, setStatus] = useState<RegulationSyncStatusOut | null>(null);
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [frequency, setFrequency] = useState<NonNullable<RegulationSyncSourceUpdate["frequency"]>>("daily");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    regulationSyncApi.status(orgId).then((data) => {
      if (!active) return;
      setStatus(data);
      if (data.source) { setFolder(data.source.folder_id); setFrequency(data.source.frequency); }
    }).catch((err: unknown) => { if (active) setError(apiErrorMessage(err, "無法載入同步設定")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orgId]);
  const pending = Boolean(status?.source?.requested_at);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = window.setInterval(() => {
      regulationSyncApi.status(orgId).then((data) => {
        if (!active) return;
        setStatus(data); setError("");
        if (!data.source?.requested_at) { setMessage("對照完成，請查看下方逐份結果。"); onSynced(); }
      }).catch((err: unknown) => { if (active) setError(apiErrorMessage(err, "查詢同步進度失敗，稍後自動重試")); });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [orgId, pending, onSynced]);

  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      setStatus(await regulationSyncApi.configure(orgId, { folder_id: folder, frequency }));
      setDirty(false); setMessage("已儲存同步設定。");
    } catch (err) { setError(apiErrorMessage(err, "儲存失敗，請稍後重試")); }
    finally { setBusy(false); }
  }
  async function run() {
    setBusy(true); setError(""); setMessage("");
    try { setStatus(await regulationSyncApi.run(orgId)); setMessage("已排入同步，通常一分鐘內開始。可離開頁面，稍後回來查看結果。"); }
    catch (err) { setError(apiErrorMessage(err, "無法開始同步，請稍後重試")); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status" className="text-sm">載入同步設定中…</p>;
  const report = status?.source?.last_report;
  return (
    <div className="space-y-4">
      {status && <>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <label className="block text-sm">Drive 資料夾網址或 ID
            <input className="input mt-1 min-h-11 w-full" value={folder} disabled={busy || pending}
              onChange={(event) => { setFolder(event.target.value); setDirty(true); }} />
          </label>
          <label className="block text-sm">自動更新頻率
            <select className="input mt-1 min-h-11 w-full" style={{ minHeight: 44 }} value={frequency} disabled={busy || pending}
              onChange={(event) => { setFrequency(event.target.value as typeof frequency); setDirty(true); }}>
              <option value="daily">每日</option><option value="weekly">每週</option><option value="manual">僅手動</option>
            </select>
          </label>
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>依來源沿革比對版本；相同內容略過，更新保留歷程。掃描檔或解析異常會列為待處理。</p>
        {!status.drive_ready && <p role="status" className="text-sm" style={{ color: "var(--primary-text)" }}>尚未連接 Drive，請由系統管理員完成來源存取設定。</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary min-h-11" style={{ color: "var(--primary-text)" }} onClick={save} disabled={busy || pending || !folder.trim()}>{busy ? "處理中…" : "儲存設定"}</button>
          <button type="button" className="btn btn-primary min-h-11" onClick={run} disabled={busy || pending || dirty || !status.configured || !status.drive_ready}>{pending ? "同步中…" : "立即對照並同步"}</button>
        </div>
        {dirty && <p className="text-sm">來源或頻率已修改，請先儲存設定。</p>}
        <div className="text-sm space-y-1" style={{ color: "var(--text-secondary)" }}>
          <p>上次完整成功：{dateLabel(status.source?.last_synced_at)}</p>
          {status.source?.next_sync_at && <p>下次檢查：{dateLabel(status.source.next_sync_at)}（臺北時間）</p>}
        </div>
      </>}
      {error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {report?.error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{report.error}</p>}
      {!!report?.items?.length && <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <p className="text-sm font-medium">最近對照：{dateLabel(report.checked_at)}</p>
        <ul className="mt-2 divide-y" style={{ borderColor: "var(--border)" }}>
          {report.items?.map((item) => <li key={item.file_id} className="py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words font-medium">{item.title || item.filename}</span>
              <span className="shrink-0" style={{ color: item.status === "error" ? "var(--danger)" : "var(--text-secondary)" }}>{STATUS_LABELS[item.status]}</span>
            </div>
            <p className="mt-1 break-words" style={{ color: "var(--text-secondary)" }}>{item.detail}{item.article_count > 0 ? ` · ${item.article_count} 條` : ""}</p>
          </li>)}
        </ul>
      </div>}
    </div>
  );
}
