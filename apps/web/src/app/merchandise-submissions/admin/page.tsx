"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileImage, LoaderCircle, Plus, Save, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage, merchandiseSubmissionsApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import type {
  MerchandiseSubmissionAdminListItem,
  MerchandiseSubmissionItemCreate,
  MerchandiseSubmissionItemOut,
  MerchandiseSubmissionSettingsOut,
  SubmissionCustomField,
} from "@/lib/types";

type ItemDraft = MerchandiseSubmissionItemCreate & { id?: string };

function emptyItem(): ItemDraft {
  return {
    name: "",
    description: "",
    specification: "",
    template_images: [],
    custom_fields: [],
    sort_order: 0,
    is_active: true,
    is_open_override: null,
    opens_at_override: null,
    closes_at_override: null,
    max_file_size_mb_override: null,
  };
}

function toLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function ItemEditor({
  draft,
  onChange,
  onSaved,
}: {
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const update = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => onChange({ ...draft, [key]: value });
  const addField = () => update("custom_fields", [...draft.custom_fields, {
    key: `field_${Date.now()}`,
    label: "新欄位",
    field_type: "text",
    required: false,
    placeholder: null,
    help_text: null,
    max_length: 200,
  }]);
  const setField = (index: number, next: SubmissionCustomField) => update("custom_fields", draft.custom_fields.map((field, i) => i === index ? next : field));
  const uploadTemplate = async (file: File) => {
    setUploadingTemplate(true);
    try {
      const result = await merchandiseSubmissionsApi.uploadTemplateImage(file);
      update("template_images", [...draft.template_images, { url: result.url, label: result.filename }]);
      toast.success("範本圖片已上傳");
    } catch (error) {
      toast.error(apiErrorMessage(error, "範本上傳失敗"));
    } finally {
      setUploadingTemplate(false);
    }
  };
  const save = async () => {
    if (!draft.name.trim()) { toast.error("請輸入品項名稱"); return; }
    setSaving(true);
    try {
      const body = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        specification: draft.specification?.trim() || null,
        opens_at_override: toIso(toLocal(draft.opens_at_override)),
        closes_at_override: toIso(toLocal(draft.closes_at_override)),
        max_file_size_mb_override: draft.max_file_size_mb_override || null,
      };
      if (draft.id) await merchandiseSubmissionsApi.updateItem(draft.id, body);
      else await merchandiseSubmissionsApi.createItem(body);
      toast.success("品項設定已儲存");
      onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法儲存品項設定"));
    } finally {
      setSaving(false);
    }
  };

  return <section className="rounded-xl border p-5 sm:p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{draft.id ? "編輯投稿品項" : "新增投稿品項"}</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>規格、範本、欄位與開放規則均可依品項覆寫全站設定。</p></div>{draft.id && <button onClick={() => onChange(emptyItem())} className="btn btn-ghost min-h-10">新增品項</button>}</div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="block"><span className="text-sm font-medium">品項名稱 *</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} className="input mt-2 w-full" placeholder="例如：運動衫" /></label>
      <label className="block"><span className="text-sm font-medium">排序</span><input type="number" value={draft.sort_order ?? 0} onChange={(event) => update("sort_order", Number(event.target.value))} className="input mt-2 w-full" /></label>
      <label className="block sm:col-span-2"><span className="text-sm font-medium">投稿說明</span><textarea value={draft.description ?? ""} onChange={(event) => update("description", event.target.value)} className="input mt-2 min-h-20 w-full py-2" placeholder="學生在選擇品項後看到的簡短說明" /></label>
      <label className="block sm:col-span-2"><span className="text-sm font-medium">詳細規格</span><textarea value={draft.specification ?? ""} onChange={(event) => update("specification", event.target.value)} className="input mt-2 min-h-36 w-full py-2" placeholder="尺寸、出血、解析度、設計限制等；支援換行" /></label>
    </div>
    <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>設計範本圖片</h3><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>會直接顯示在學生投稿頁，可點擊原圖下載。</p></div><label className="btn btn-ghost min-h-10 cursor-pointer">{uploadingTemplate ? <LoaderCircle className="animate-spin" size={15} /> : <Upload size={15} />}上傳範本圖片<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => event.target.files?.[0] && void uploadTemplate(event.target.files[0])} /></label></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{draft.template_images.map((template, index) => <div key={`${template.url}-${index}`} className="flex gap-3 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
        {/* 管理端必須立即預覽新上傳範本，且 URL 由儲存服務提供。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={uploadUrl(template.url)} alt="範本預覽" className="h-20 w-20 rounded object-contain" style={{ background: "var(--bg-elevated)" }} />
        <div className="min-w-0 flex-1"><input value={template.label} onChange={(event) => update("template_images", draft.template_images.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} className="input h-9 w-full text-xs" placeholder="範本名稱" /><button onClick={() => update("template_images", draft.template_images.filter((_, i) => i !== index))} className="mt-2 text-xs" style={{ color: "var(--danger)" }}>移除圖片</button></div></div>)}</div>
    </div>
    <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>學生填寫欄位</h3><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>只會顯示這裡設定的欄位，校務帳戶資料會自動帶入。</p></div><button onClick={addField} className="btn btn-ghost min-h-10"><Plus size={15} />新增欄位</button></div>
      <div className="mt-4 space-y-3">{draft.custom_fields.map((field, index) => <div key={field.key} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_8rem_auto]" style={{ borderColor: "var(--border)" }}><input value={field.label} onChange={(event) => setField(index, { ...field, label: event.target.value })} className="input h-10" placeholder="欄位名稱" /><select value={field.field_type} onChange={(event) => setField(index, { ...field, field_type: event.target.value as SubmissionCustomField["field_type"] })} className="input h-10"><option value="text">單行文字</option><option value="textarea">多行文字</option></select><input type="number" value={field.max_length} onChange={(event) => setField(index, { ...field, max_length: Number(event.target.value) || 200 })} className="input h-10" title="字數上限" /><div className="flex items-center gap-2"><label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={field.required} onChange={(event) => setField(index, { ...field, required: event.target.checked })} />必填</label><button aria-label={`移除${field.label}`} onClick={() => update("custom_fields", draft.custom_fields.filter((_, i) => i !== index))} className="topbar-icon-btn h-10 w-10"><X size={15} /></button></div><input value={field.key} onChange={(event) => setField(index, { ...field, key: event.target.value.replace(/[^a-z0-9_]/g, "") })} className="input h-10 md:col-span-2" placeholder="欄位代碼（英數與底線）" /><input value={field.placeholder ?? ""} onChange={(event) => setField(index, { ...field, placeholder: event.target.value || null })} className="input h-10 md:col-span-2" placeholder="提示文字（選填）" /></div>)}</div>
    </div>
    <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>個別開放覆寫</h3><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_open_override === true} onChange={(event) => update("is_open_override", event.target.checked ? true : null)} />強制開放（取消即沿用全站）</label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_active ?? true} onChange={(event) => update("is_active", event.target.checked)} />品項啟用</label><label><span className="text-xs" style={{ color: "var(--text-muted)" }}>個別開始時間</span><input type="datetime-local" value={toLocal(draft.opens_at_override)} onChange={(event) => update("opens_at_override", event.target.value || null)} className="input mt-1 w-full" /></label><label><span className="text-xs" style={{ color: "var(--text-muted)" }}>個別截止時間</span><input type="datetime-local" value={toLocal(draft.closes_at_override)} onChange={(event) => update("closes_at_override", event.target.value || null)} className="input mt-1 w-full" /></label><label><span className="text-xs" style={{ color: "var(--text-muted)" }}>個別檔案上限（MB）</span><input type="number" min="1" max="250" value={draft.max_file_size_mb_override ?? ""} onChange={(event) => update("max_file_size_mb_override", event.target.value ? Number(event.target.value) : null)} className="input mt-1 w-full" placeholder="沿用全站" /></label></div>
    </div>
    <div className="mt-6 flex justify-end"><button disabled={saving} onClick={() => void save()} className="btn min-h-11" style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}儲存品項設定</button></div>
  </section>;
}

function ReviewRow({ submission, onReviewed }: { submission: MerchandiseSubmissionAdminListItem; onReviewed: () => void }) {
  const [status, setStatus] = useState<"reviewing" | "approved" | "revision_requested" | "rejected">(submission.status === "draft" || submission.status === "submitted" ? "reviewing" : submission.status);
  const [note, setNote] = useState(submission.review_note ?? "");
  const [saving, setSaving] = useState(false);
  const review = async () => {
    setSaving(true);
    try { await merchandiseSubmissionsApi.review(submission.id, { status, review_note: note || null }); toast.success("審核結果已儲存，學生會收到通知"); onReviewed(); }
    catch (error) { toast.error(apiErrorMessage(error, "無法儲存審核結果")); }
    finally { setSaving(false); }
  };
  return <article className="border-b py-4 last:border-0" style={{ borderColor: "var(--border)" }}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold" style={{ color: "var(--text-primary)" }}>{submission.item_name} <span className="font-normal" style={{ color: "var(--text-muted)" }}>· {submission.submitter_name} · {submission.submitter_student_id || "未填學號"}</span></p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{submission.submitter_email} · {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString("zh-TW") : "草稿"}</p></div><span className="rounded px-2 py-1 text-xs font-medium" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>{submission.status}</span></div><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(submission.field_values).map(([key, value]) => <div key={key}><dt className="text-xs" style={{ color: "var(--text-muted)" }}>{key}</dt><dd style={{ color: "var(--text-secondary)" }}>{value}</dd></div>)}</dl><div className="mt-3 flex flex-wrap gap-2">{submission.files.map((file) => <a key={file.id} href={uploadUrl(file.url)} target="_blank" rel="noreferrer" className="btn btn-ghost min-h-9 text-xs"><FileImage size={14} />{file.filename}</a>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-[11rem_1fr_auto]"><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="input"><option value="reviewing">審核中</option><option value="approved">採用</option><option value="revision_requested">請補件</option><option value="rejected">未採用</option></select><input value={note} onChange={(event) => setNote(event.target.value)} className="input" placeholder="給學生的審核說明（選填）" /><button disabled={saving} onClick={() => void review()} className="btn min-h-11" style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>{saving ? "儲存中…" : "儲存審核"}</button></div></article>;
}

export default function MerchandiseSubmissionsAdminPage() {
  const { can } = usePermissions();
  const [settings, setSettings] = useState<MerchandiseSubmissionSettingsOut | null>(null);
  const [items, setItems] = useState<MerchandiseSubmissionItemOut[]>([]);
  const [submissions, setSubmissions] = useState<MerchandiseSubmissionAdminListItem[]>([]);
  const [draft, setDraft] = useState<ItemDraft>(emptyItem());
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const [nextSettings, nextItems, nextSubmissions] = await Promise.all([merchandiseSubmissionsApi.getSettings(), merchandiseSubmissionsApi.listItems(), merchandiseSubmissionsApi.listSubmissions()]); setSettings(nextSettings); setItems(nextItems); setSubmissions(nextSubmissions); } catch (error) { toast.error(apiErrorMessage(error, "無法載入投稿管理設定")); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const current = useMemo(() => items.find((item) => item.id === draft.id), [draft.id, items]);
  const edit = (item: MerchandiseSubmissionItemOut) => setDraft({ ...item });
  const saveSettings = async () => { if (!settings) return; setSavingSettings(true); try { const updated = await merchandiseSubmissionsApi.updateSettings({ is_open: settings.is_open, opens_at: toIso(toLocal(settings.opens_at)), closes_at: toIso(toLocal(settings.closes_at)), max_file_size_mb: settings.max_file_size_mb, require_school_email: settings.require_school_email, announcement: settings.announcement || null }); setSettings(updated); toast.success("全站投稿設定已儲存"); } catch (error) { toast.error(apiErrorMessage(error, "無法儲存全站設定")); } finally { setSavingSettings(false); } };
  if (!can("shop:manage")) return <main className="p-6"><h1 className="text-xl font-bold">無法存取投稿管理</h1><p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>需要商品管理權限。</p></main>;
  if (loading || !settings) return <main className="p-6"><div className="h-36 animate-pulse rounded-xl" style={{ background: "var(--bg-elevated)" }} /></main>;
  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8"><header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6" style={{ borderColor: "var(--border)" }}><div><p className="text-sm font-semibold" style={{ color: "var(--primary-text)" }}>商品系統整合</p><h1 className="mt-1 text-2xl font-bold tracking-tight">校商投稿管理</h1><p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>設定全站開放規則、品項圖稿規格與學生投稿審核。</p></div><Link href="/merchandise-submissions" className="btn btn-ghost min-h-11">查看學生投稿頁<ChevronRight size={16} /></Link></header><section className="rounded-xl border p-5 sm:p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">全站投稿設定</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>品項可個別覆寫以下設定。</p></div><label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={settings.is_open} onChange={(event) => setSettings({ ...settings, is_open: event.target.checked })} />開放投稿</label></div><div className="mt-5 grid gap-4 sm:grid-cols-3"><label><span className="text-xs" style={{ color: "var(--text-muted)" }}>開始時間</span><input type="datetime-local" value={toLocal(settings.opens_at)} onChange={(event) => setSettings({ ...settings, opens_at: toIso(event.target.value) })} className="input mt-1 w-full" /></label><label><span className="text-xs" style={{ color: "var(--text-muted)" }}>截止時間</span><input type="datetime-local" value={toLocal(settings.closes_at)} onChange={(event) => setSettings({ ...settings, closes_at: toIso(event.target.value) })} className="input mt-1 w-full" /></label><label><span className="text-xs" style={{ color: "var(--text-muted)" }}>單檔上限（MB）</span><input type="number" min="1" max="250" value={settings.max_file_size_mb} onChange={(event) => setSettings({ ...settings, max_file_size_mb: Number(event.target.value) || 1 })} className="input mt-1 w-full" /></label><label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={settings.require_school_email} onChange={(event) => setSettings({ ...settings, require_school_email: event.target.checked })} />僅限校務信箱投稿<span className="text-xs" style={{ color: "var(--text-muted)" }}>（依系統允許的校務信箱網域驗證）</span></label><label className="sm:col-span-3"><span className="text-xs" style={{ color: "var(--text-muted)" }}>公告訊息</span><textarea value={settings.announcement ?? ""} onChange={(event) => setSettings({ ...settings, announcement: event.target.value || null })} className="input mt-1 min-h-20 w-full py-2" placeholder="顯示在學生投稿頁上方（選填）" /></label></div><div className="mt-5 flex justify-end"><button disabled={savingSettings} onClick={() => void saveSettings()} className="btn min-h-11" style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>{savingSettings ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}儲存全站設定</button></div></section><div className="grid items-start gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]"><aside className="rounded-xl border p-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><div className="flex items-center justify-between gap-2 px-2 pb-3"><h2 className="font-semibold">投稿品項</h2><button onClick={() => setDraft(emptyItem())} className="topbar-icon-btn h-10 w-10" aria-label="新增品項"><Plus size={17} /></button></div><div className="space-y-1">{items.map((item) => <button key={item.id} onClick={() => edit(item)} className="w-full rounded-lg px-3 py-3 text-left text-sm" style={{ background: current?.id === item.id ? "var(--primary-dim)" : "transparent", color: "var(--text-primary)" }}><span className="block font-medium">{item.name}</span><span className="mt-1 block text-xs" style={{ color: item.is_active ? "var(--success)" : "var(--text-muted)" }}>{item.is_active ? "啟用中" : "已停用"}</span></button>)}{items.length === 0 && <p className="px-2 py-6 text-sm" style={{ color: "var(--text-muted)" }}>尚無投稿品項。</p>}</div></aside><ItemEditor draft={draft} onChange={setDraft} onSaved={() => { setDraft(emptyItem()); void load(); }} /></div><section className="rounded-xl border p-5 sm:p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><div><h2 className="font-semibold">投稿審核</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>更新狀態後，學生會在通知中心收到結果。</p></div><div className="mt-4">{submissions.length ? submissions.map((submission) => <ReviewRow key={submission.id} submission={submission} onReviewed={() => void load()} />) : <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>目前尚未收到投稿。</p>}</div></section></main>;
}
