"use client";

import { useEffect, useState } from "react";
import { gallerySyncApi } from "@/lib/api/gallery-sync";
import { apiErrorMessage } from "@/lib/api-helpers";
import type { GalleryDriveConfig, GalleryDriveStatusOut } from "@/lib/types";
import type { PublicActivityAlbum } from "@/lib/public-activity-albums";
import "./gallery-drive.css";

type Props = { albums: PublicActivityAlbum[]; disabled: boolean; onSynced: () => void };
type Config = Required<GalleryDriveConfig>;
const normalize = (config: GalleryDriveConfig): Config => ({ sources: config.sources ?? [], photographers: config.photographers ?? [], frequency: config.frequency });

export default function GalleryDrivePanel(props: Props) {
  const [opened, setOpened] = useState(false);
  return <details className="gallery-drive-panel" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>Google Drive 同步</summary>
    {opened && <DriveSettings {...props} />}
  </details>;
}

function DriveSettings({ albums, disabled, onSynced }: Props) {
  const [status, setStatus] = useState<GalleryDriveStatusOut | null>(null);
  const [config, setConfig] = useState<Config>(normalize({ frequency: "quarter_hour" }));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = Boolean(status?.requested_at);

  useEffect(() => {
    let active = true;
    gallerySyncApi.status().then((data) => {
      if (active) { setStatus(data); setConfig(normalize(data.config)); }
    }).catch((cause: unknown) => { if (active) setError(apiErrorMessage(cause, "無法載入 Drive 設定，請重新整理頁面")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = window.setInterval(() => {
      gallerySyncApi.status().then((data) => {
        if (!active) return;
        setStatus(data); setError("");
        if (!data.requested_at) {
          setMessage(data.last_report.errors?.length ? "同步完成，部分來源待處理" : "同步完成");
          if (!disabled) onSynced();
        }
      }).catch((cause: unknown) => { if (active) setError(apiErrorMessage(cause, "查詢進度失敗，稍後自動重試")); });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pending, onSynced, disabled]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(patch: Partial<GalleryDriveConfig>) {
    setConfig((current) => ({ ...current, ...patch })); setDirty(true); setMessage("");
  }
  async function perform(save: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const data = save ? await gallerySyncApi.configure(config) : await gallerySyncApi.run();
      setStatus(data); setConfig(normalize(data.config)); setDirty(false);
      setMessage(data.requested_at ? "已排入同步" : "已儲存 Drive 設定");
    } catch (cause) { setError(apiErrorMessage(cause, save ? "儲存失敗，請檢查來源與攝影師設定" : "無法開始同步")); }
    finally { setBusy(false); }
  }

  if (loading) return <p role="status">載入 Drive 設定中…</p>;
  return <div className="gallery-drive-settings">
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {status && <>
      {disabled && <p role="status">請先發布活動變更，再管理 Drive 來源。</p>}
      {!status.drive_ready && <p role="status">尚未設定 Google Drive 唯讀授權，請由系統管理員完成連線。</p>}
      <fieldset disabled={disabled || busy || pending}>
        <legend>照片來源</legend>
        {!config.sources.length && <p>尚未設定照片來源</p>}
        {config.sources.map((source, index) => <div className="gallery-drive-source" key={index}>
          <label>活動 {index + 1}<select value={source.album_id} onChange={(event) => edit({ sources: config.sources.map((item, i) => i === index ? { ...item, album_id: event.target.value } : item) })}>
            <option value="">選擇活動</option>
            {albums.map((album) => <option value={album.id} key={album.id}>{album.title}</option>)}
          </select></label>
          <label>資料夾網址或 ID {index + 1}<input value={source.folder_id} maxLength={300} onChange={(event) => edit({ sources: config.sources.map((item, i) => i === index ? { ...item, folder_id: event.target.value } : item) })} /></label>
          <label>活動環節 {index + 1}<input value={source.section} maxLength={120} onChange={(event) => edit({ sources: config.sources.map((item, i) => i === index ? { ...item, section: event.target.value } : item) })} /></label>
          <label>資料夾預設攝影師 {index + 1}<input value={source.photographer} maxLength={120} onChange={(event) => edit({ sources: config.sources.map((item, i) => i === index ? { ...item, photographer: event.target.value } : item) })} /></label>
          <label className="gallery-drive-check"><input type="checkbox" checked={source.recursive ?? true} onChange={(event) => edit({ sources: config.sources.map((item, i) => i === index ? { ...item, recursive: event.target.checked } : item) })} />包含子資料夾</label>
          <button type="button" className="btn btn-ghost" aria-label={`移除來源 ${index + 1}`} onClick={() => edit({ sources: config.sources.filter((_, i) => i !== index) })}>移除來源</button>
        </div>)}
        <button type="button" className="btn btn-secondary" disabled={!albums.length || config.sources.length >= 50} onClick={() => edit({ sources: [...config.sources, { album_id: albums[0]?.id ?? "", folder_id: "", section: "", photographer: "", recursive: true }] })}>新增資料夾</button>
        <h3>攝影師對應</h3>
        <p className="gallery-drive-note">公開 Drive 無法確認原始上傳者；以檔案擁有者電子郵件配對，無法配對時使用資料夾預設攝影師。</p>
        {config.photographers.map((person, index) => <div className="gallery-drive-person" key={index}>
          <label>電子郵件 {index + 1}<input type="email" value={person.email} onChange={(event) => edit({ photographers: config.photographers.map((item, i) => i === index ? { ...item, email: event.target.value } : item) })} /></label>
          <label>攝影師姓名 {index + 1}<input value={person.name} maxLength={120} onChange={(event) => edit({ photographers: config.photographers.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></label>
          <button type="button" className="btn btn-ghost" aria-label={`移除攝影師對應 ${index + 1}`} onClick={() => edit({ photographers: config.photographers.filter((_, i) => i !== index) })}>移除對應</button>
        </div>)}
        <button type="button" className="btn btn-secondary" disabled={config.photographers.length >= 200} onClick={() => edit({ photographers: [...config.photographers, { email: "", name: "" }] })}>新增攝影師對應</button>
        <label className="gallery-drive-frequency">自動同步頻率<select value={config.frequency} onChange={(event) => edit({ frequency: event.target.value as GalleryDriveConfig["frequency"] })}>
          <option value="quarter_hour">每 15 分鐘</option><option value="daily">每日</option><option value="manual">僅手動</option>
        </select></label>
        <div className="gallery-drive-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void perform(true)} disabled={!dirty}>{busy ? "處理中…" : "儲存 Drive 設定"}</button>
          <button type="button" className="btn btn-primary" onClick={() => void perform(false)} disabled={dirty || !status.drive_ready || !status.config.sources?.length}>立即同步照片</button>
        </div>
      </fieldset>
      {pending && <p role="status">照片同步中…</p>}
      {status.last_report.checked_at && <div className="gallery-drive-report">
        <p>最近檢查：{new Date(status.last_report.checked_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>
        <p>新增 {status.last_report.created} · 更新 {status.last_report.updated} · 未變更 {status.last_report.unchanged} · 未署名 {status.last_report.unattributed}</p>
        {Boolean(status.last_report.errors?.length) && <ul aria-label="同步問題">{status.last_report.errors?.map((item, index) => <li key={index}>{item}</li>)}</ul>}
      </div>}
    </>}
  </div>;
}
