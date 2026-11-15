"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import { siteApi } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { uploadUrl } from "@/lib/config";
import { galleryFingerprint, gallerySettingsValue, readActivityAlbums, type GalleryPhoto, type PublicActivityAlbum } from "@/lib/public-activity-albums";
import { uploadGalleryPhoto } from "@/lib/gallery-upload";
import "./gallery-admin.css";

export default function GalleryAdminPage() {
  const { can, isReady } = usePermissions();
  const allowed = can("site:manage");
  const [events, setEvents] = useState<PublicActivityAlbum[]>([]);
  const [activeId, setActiveId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [credit, setCredit] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState<{ eventId: string; files: File[]; poster: boolean; photographer: string } | null>(null);
  const baseline = useRef("");
  const active = events.find((event) => event.id === activeId);
  const photographers = [...new Set(events.flatMap((event) => [
    event.photographer, ...event.photos.map((photo) => photo.photographer),
  ]).filter((value): value is string => Boolean(value)))];

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const settings = await siteApi.adminSettings();
      const albums = readActivityAlbums(settings.homepage_blocks);
      baseline.current = galleryFingerprint(settings.homepage_blocks?.activity_gallery);
      setEvents(albums);
      setActiveId(albums[0]?.id ?? "");
      setCredit(albums[0]?.photographer ?? "");
      setSelected(new Set());
      setDirty(false);
      setFailed(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "載入活動影像失敗");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isReady && allowed) void load(); }, [isReady, allowed, load]);
  useEffect(() => {
    if (!dirty && !uploading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uploading]);

  const updateEvent = (id: string, transform: (event: PublicActivityAlbum) => PublicActivityAlbum) => {
    setEvents((current) => current.map((event) => event.id === id ? transform(event) : event));
    setDirty(true); setStatus("");
  };
  const updatePhoto = (id: string, patch: Partial<GalleryPhoto>) => {
    updateEvent(activeId, (event) => ({ ...event, photos: event.photos.map((photo) => photo.id === id ? { ...photo, ...patch } : photo) }));
  };

  const save = async () => {
    setError(""); setStatus("");
    if (events.some((event) => !event.title.trim())) { setError("請填寫每個活動的名稱"); return; }
    if (events.some((event) => event.sourceUrl && !/^https?:\/\//.test(event.sourceUrl))) {
      setError("原始相簿連結須使用完整的 http 或 https 網址"); return;
    }
    setBusy(true);
    try {
      const fresh = await siteApi.adminSettings();
      if (galleryFingerprint(fresh.homepage_blocks?.activity_gallery) !== baseline.current) {
        throw new Error("活動資料已被其他人更新，請重新載入後再編輯。");
      }
      const value = gallerySettingsValue(events);
      await siteApi.updateSettings({ homepage_blocks: { ...fresh.homepage_blocks, activity_gallery: value } });
      baseline.current = galleryFingerprint(value);
      setDirty(false);
      setStatus("活動影像已發布");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "發布失敗，變更仍保留在此頁，請重試");
    } finally { setBusy(false); }
  };

  const upload = async (files: File[], poster = false, targetId = activeId, photographer = credit) => {
    if (!files.length || !targetId) return;
    if (files.length > 100) { setError("每批最多上傳 100 張照片"); return; }
    setUploading(true); setError(""); setFailed(null);
    const failures: File[] = [];
    const reasons: string[] = [];
    let count = 0;
    for (let index = 0; index < files.length; index += 1) {
      setStatus("正在上傳 " + (index + 1) + " / " + files.length);
      try {
        const photo = await uploadGalleryPhoto(files[index], poster ? undefined : photographer);
        updateEvent(targetId, (event) => poster
          ? { ...event, keyVisual: { ...photo, caption: "活動主視覺", alt: event.title + "活動主視覺" } }
          : { ...event, photos: [...event.photos, { ...photo, alt: event.title + "活動照片" }] });
        count += 1;
      } catch (cause) {
        failures.push(files[index]);
        reasons.push(files[index].name + "：" + (cause instanceof Error ? cause.message : "上傳失敗"));
      }
    }
    setUploading(false);
    setStatus("已上傳 " + count + " 張，發布後顯示於網站");
    if (failures.length) {
      setFailed({ eventId: targetId, files: failures, poster, photographer });
      setError("上傳失敗：" + reasons.join("；"));
    }
  };

  const movePhoto = (index: number, step: number) => {
    updateEvent(activeId, (event) => {
      const photos = [...event.photos];
      const target = index + step;
      if (target < 0 || target >= photos.length) return event;
      [photos[index], photos[target]] = [photos[target], photos[index]];
      return { ...event, photos };
    });
  };

  if (!isReady) return <p role="status">正在確認權限…</p>;
  if (!allowed) return <p role="alert">你沒有管理公開網站的權限。</p>;

  return <div className="gallery-admin">
    <header className="gallery-admin-heading">
      <div><Link href="/admin/public-site">公開網站工作台</Link><h1>活動影像管理</h1></div>
      <div><Link className="btn btn-ghost" href="/gallery" target="_blank">預覽影像紀事</Link>
        <button type="button" className="btn btn-primary" disabled={loading || busy || uploading || !dirty} onClick={() => void save()}><Save size={17} aria-hidden />{busy ? "發布中…" : "發布變更"}</button></div>
    </header>
    {error && <div role="alert" className="gallery-admin-error">{error}
      {!events.length && <button type="button" onClick={() => void load()}>重新載入</button>}
      {failed && <button type="button" disabled={uploading} onClick={() => void upload(failed.files, failed.poster, failed.eventId, failed.photographer)}>重試失敗的 {failed.files.length} 張</button>}
      {!failed && events.length > 0 && <button type="button" disabled={uploading || busy} onClick={() => {
        if (!dirty || window.confirm("捨棄此頁尚未發布的變更並重新載入？")) void load();
      }}>重新載入</button>}
    </div>}
    {status && <p role="status">{status}</p>}
    {loading ? <p role="status">正在載入活動影像…</p> : <fieldset disabled={busy || uploading} className="gallery-admin-workspace">
      <div className="gallery-admin-event-bar">
        <label>活動<select value={activeId} onChange={(event) => {
          setActiveId(event.target.value); setSelected(new Set());
          setCredit(events.find((item) => item.id === event.target.value)?.photographer ?? "");
        }}><option value="" disabled>選擇活動</option>{events.map((event) => <option value={event.id} key={event.id}>{event.title || "未命名活動"}</option>)}</select></label>
        <button type="button" className="btn btn-ghost" onClick={() => {
          const id = "event-" + crypto.randomUUID();
          setEvents((current) => [...current, { id, title: "", summary: "", sourceUrl: "", layout: "spread", photos: [] }]);
          setActiveId(id); setSelected(new Set()); setCredit(""); setDirty(true);
        }}><Plus size={17} aria-hidden />新增活動</button>
      </div>
      {active && <>
        <section className="gallery-admin-event-fields" aria-label="活動資料">
          <label>活動名稱<input value={active.title} maxLength={160} onChange={(event) => updateEvent(activeId, (item) => ({ ...item, title: event.target.value }))} /></label>
          <label>活動日期<input type="date" value={active.date ?? ""} onChange={(event) => updateEvent(activeId, (item) => ({ ...item, date: event.target.value || undefined }))} /></label>
          <label className="gallery-admin-wide">活動紀錄<textarea rows={3} maxLength={2000} value={active.summary} onChange={(event) => updateEvent(activeId, (item) => ({ ...item, summary: event.target.value }))} /></label>
          <label>原始相簿連結（選填）<input type="url" value={active.sourceUrl} onChange={(event) => updateEvent(activeId, (item) => ({ ...item, sourceUrl: event.target.value }))} /></label>
          <label>精選編排<select value={active.layout} onChange={(event) => updateEvent(activeId, (item) => ({ ...item, layout: event.target.value as PublicActivityAlbum["layout"] }))}>
            <option value="spread">開闊編排</option><option value="journal">交錯敘事</option><option value="film">橫向膠卷</option>
          </select></label>
        </section>
        <section className="gallery-admin-poster" aria-labelledby="gallery-poster-title">
          <div><h2 id="gallery-poster-title">活動主視覺</h2>
            <label className="btn btn-ghost gallery-admin-file"><ImagePlus size={17} aria-hidden />{active.keyVisual ? "更換主視覺" : "上傳主視覺"}<input aria-label="上傳活動主視覺" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const files = [...(event.target.files ?? [])]; event.target.value = ""; void upload(files.slice(0, 1), true);
            }} /></label>
            {active.keyVisual && <><label>主視覺署名（選填）<input value={active.keyVisual.photographer ?? ""} onChange={(event) => updateEvent(activeId, (item) => ({
              ...item, keyVisual: item.keyVisual ? { ...item.keyVisual, photographer: event.target.value || undefined } : undefined,
            }))} /></label><button type="button" className="btn btn-ghost" onClick={() => updateEvent(activeId, (item) => ({ ...item, keyVisual: undefined }))}>移除主視覺</button></>}
          </div>
          {active.keyVisual && <Image src={uploadUrl(active.keyVisual.src)} alt={active.keyVisual.alt} width={active.keyVisual.width} height={active.keyVisual.height} sizes="240px" />}
        </section>
        <section aria-labelledby="gallery-photos-title">
          <div className="gallery-admin-photo-heading"><h2 id="gallery-photos-title">活動照片 <span>{active.photos.length}</span></h2>
            <label className="btn btn-primary gallery-admin-file"><ImagePlus size={17} aria-hidden />批次上傳照片<input aria-label="批次上傳活動照片" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const files = [...(event.target.files ?? [])]; event.target.value = ""; void upload(files);
            }} /></label>
          </div>
          <div className="gallery-admin-credit-bar">
            <label>攝影師<input list="gallery-photographers" value={credit} onChange={(event) => setCredit(event.target.value)} /></label>
            <datalist id="gallery-photographers">{photographers.map((name) => <option key={name} value={name} />)}</datalist>
            <button type="button" className="btn btn-ghost" onClick={() => updateEvent(activeId, (event) => ({ ...event, photographer: credit.trim() || undefined }))}>設為活動預設</button>
            <button type="button" className="btn btn-ghost" disabled={!selected.size} onClick={() => updateEvent(activeId, (event) => ({
              ...event, photos: event.photos.map((photo) => selected.has(photo.id) ? { ...photo, photographer: credit.trim() || undefined } : photo),
            }))}>套用到選取的 {selected.size} 張</button>
          </div>
          {active.photographer && <p className="gallery-admin-default-credit">活動預設攝影師：{active.photographer}</p>}
          {active.photos.length > 0 && <label className="gallery-admin-select-all"><input type="checkbox" checked={selected.size === active.photos.length} onChange={(event) => setSelected(event.target.checked ? new Set(active.photos.map((photo) => photo.id)) : new Set())} />全選照片</label>}
          <div className="gallery-admin-photos">
            {active.photos.map((photo, index) => <article key={photo.id} className="gallery-admin-photo">
              <div className="gallery-admin-thumb"><Image src={uploadUrl(photo.src)} alt={photo.alt || active.title + "活動照片"} width={photo.width} height={photo.height} sizes="(max-width: 767px) 90vw, 300px" />
                <label><input type="checkbox" aria-label={"選取照片 " + (index + 1)} checked={selected.has(photo.id)} onChange={(event) => setSelected((current) => {
                  const next = new Set(current); if (event.target.checked) next.add(photo.id); else next.delete(photo.id); return next;
                })} /></label>
              </div>
              <label>照片說明<input value={photo.caption} maxLength={500} onChange={(event) => updatePhoto(photo.id, { caption: event.target.value, alt: event.target.value || active.title + "活動照片" })} /></label>
              <label>攝影師<input list="gallery-photographers" value={photo.photographer ?? ""} placeholder={active.photographer || "未署名"} onChange={(event) => updatePhoto(photo.id, { photographer: event.target.value || undefined })} /></label>
              <div className="gallery-admin-photo-actions">
                <label><input type="checkbox" checked={photo.featured} onChange={(event) => updatePhoto(photo.id, { featured: event.target.checked })} />精選</label>
                <button type="button" aria-label={"照片 " + (index + 1) + "往前"} disabled={index === 0} onClick={() => movePhoto(index, -1)}><ArrowUp size={17} /></button>
                <button type="button" aria-label={"照片 " + (index + 1) + "往後"} disabled={index === active.photos.length - 1} onClick={() => movePhoto(index, 1)}><ArrowDown size={17} /></button>
                <button type="button" aria-label={"移除照片 " + (index + 1)} onClick={() => {
                  updateEvent(activeId, (event) => ({ ...event, photos: event.photos.filter((item) => item.id !== photo.id) }));
                  setSelected((current) => { const next = new Set(current); next.delete(photo.id); return next; });
                }}><Trash2 size={17} /></button>
              </div>
            </article>)}
          </div>
          {active.photos.length === 0 && <p>尚未加入照片。</p>}
        </section>
        <footer className="gallery-admin-event-footer">
          <button type="button" className="btn btn-ghost" disabled={events.findIndex((event) => event.id === activeId) === 0} onClick={() => {
            const index = events.findIndex((event) => event.id === activeId);
            setEvents((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; });
            setDirty(true);
          }}>活動往前排列</button>
          <button type="button" className="btn btn-ghost" onClick={() => {
            if (!window.confirm("將「" + (active.title || "未命名活動") + "」從網站移除？發布變更後生效。")) return;
            const next = events.filter((event) => event.id !== activeId);
            setEvents(next); setActiveId(next[0]?.id ?? ""); setCredit(next[0]?.photographer ?? ""); setSelected(new Set()); setDirty(true);
          }}>移除活動</button>
        </footer>
      </>}
    </fieldset>}
  </div>;
}
