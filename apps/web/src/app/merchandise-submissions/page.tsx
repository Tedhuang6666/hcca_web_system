"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock3, Download, FileText, LoaderCircle, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage, merchandiseSubmissionsApi, usersApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import type {
  MerchandiseSubmissionItemPortalOut,
  MerchandiseSubmissionOut,
  MerchandiseSubmissionPortalOut,
  MerchandiseSubmissionUploadOut,
} from "@/lib/types";

const STATUS_LABEL: Record<MerchandiseSubmissionOut["status"], string> = {
  draft: "草稿",
  submitted: "已送出",
  reviewing: "審核中",
  approved: "已採用",
  revision_requested: "需要補件",
  rejected: "未採用",
};

function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未設定";
}

function UploadBox({
  item,
  files,
  onChange,
}: {
  item: MerchandiseSubmissionItemPortalOut;
  files: MerchandiseSubmissionUploadOut[];
  onChange: (files: MerchandiseSubmissionUploadOut[]) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const uploadFiles = async (source: FileList | null) => {
    if (!source?.length) return;
    if (files.length + source.length > 10) {
      toast.error("每次投稿最多可上傳 10 個檔案");
      return;
    }
    setUploading(true);
    try {
      const uploaded: MerchandiseSubmissionUploadOut[] = [];
      for (const file of Array.from(source)) uploaded.push(await merchandiseSubmissionsApi.upload(item.id, file));
      onChange([...files, ...uploaded]);
      toast.success(`已上傳 ${uploaded.length} 個檔案`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "上傳失敗，請確認檔案格式與大小"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <label
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-5 text-center transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
        <Upload size={28} style={{ color: "var(--primary-text)" }} aria-hidden="true" />
        <span className="text-sm font-medium">{uploading ? "正在上傳…" : "選擇圖稿檔案"}</span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          支援 JPG、PNG、WebP、PDF；單檔上限 {item.effective_max_file_size_mb} MB
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          className="sr-only"
          disabled={uploading}
          onChange={(event) => uploadFiles(event.target.files)}
        />
      </label>
      {files.length > 0 && (
        <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--border)" }} aria-label="已上傳檔案">
          {files.map((file) => (
            <li key={file.storage_key} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <FileText size={18} style={{ color: "var(--primary-text)" }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>{file.filename}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{(file.file_size / 1024 / 1024).toFixed(1)} MB</span>
              <button
                type="button"
                aria-label={`移除 ${file.filename}`}
                onClick={() => onChange(files.filter((entry) => entry.storage_key !== file.storage_key))}
                className="topbar-icon-btn h-9 w-9">
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MerchandiseSubmissionsPage() {
  const { can } = usePermissions();
  const [portal, setPortal] = useState<MerchandiseSubmissionPortalOut | null>(null);
  const [submissions, setSubmissions] = useState<MerchandiseSubmissionOut[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<MerchandiseSubmissionUploadOut[]>([]);
  const [profile, setProfile] = useState({ displayName: "", email: "", studentId: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => portal?.items.find((item) => item.id === selectedId) ?? null,
    [portal, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [portalData, mine, me] = await Promise.all([
        merchandiseSubmissionsApi.portal(),
        merchandiseSubmissionsApi.mine(),
        usersApi.me(),
      ]);
      setPortal(portalData);
      setSubmissions(mine);
      setSelectedId((current) => current || portalData.items[0]?.id || "");
      setProfile({ displayName: me.display_name, email: me.email, studentId: me.student_id ?? "未設定" });
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法載入校商投稿"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chooseItem = (id: string) => {
    setSelectedId(id);
    setValues({});
    setFiles([]);
  };

  const save = async (submit: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      const saved = await merchandiseSubmissionsApi.save({
        item_id: selected.id,
        field_values: values,
        files,
      }, submit);
      setSubmissions((current) => [saved, ...current]);
      setFiles([]);
      setValues({});
      toast.success(submit ? "投稿已送出，審核結果會透過通知中心告知你。" : "草稿已儲存");
    } catch (error) {
      toast.error(apiErrorMessage(error, submit ? "無法送出投稿" : "無法儲存草稿"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <main className="p-6"><div className="h-36 animate-pulse rounded-xl" style={{ background: "var(--bg-elevated)" }} /></main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--primary-text)" }}>校園商品設計徵集</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>校商投稿</h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>選擇想設計的品項，依規格上傳圖稿並送出審核。</p>
        </div>
        {can("shop:manage") && <Link href="/merchandise-submissions/admin" className="btn btn-ghost min-h-11">管理投稿設定</Link>}
      </header>

      <section className="grid gap-px overflow-hidden rounded-xl border sm:grid-cols-3" style={{ borderColor: "var(--border)", background: "var(--border)" }} aria-label="已驗證校務帳戶">
        {[["姓名", profile.displayName], ["校務信箱", profile.email], ["學號", profile.studentId]].map(([label, value]) => (
          <div key={label} className="min-h-20 bg-[var(--bg-surface)] px-4 py-3">
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</p>
            <p className="mt-1 truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value || "讀取中"}</p>
          </div>
        ))}
      </section>

      {portal?.settings.announcement && (
        <p className="rounded-lg border px-4 py-3 text-sm" style={{ background: "var(--primary-dim)", borderColor: "var(--warning-border)", color: "var(--text-secondary)" }}>
          {portal.settings.announcement}
        </p>
      )}

      {!portal?.items.length ? (
        <section className="py-16 text-center"><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>目前尚未建立投稿品項</h2><p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>請等待管理員建立品項後再回來投稿。</p></section>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="space-y-6">
            <div className="rounded-xl border p-5 sm:p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <label htmlFor="submission-item" className="block text-sm font-semibold" style={{ color: "var(--text-primary)" }}>1. 選擇投稿品項</label>
              <select id="submission-item" value={selectedId} onChange={(event) => chooseItem(event.target.value)} className="input mt-3 w-full">
                {portal?.items.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_accepting ? "" : "（目前未開放）"}</option>)}
              </select>
              {selected?.description && <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>{selected.description}</p>}
            </div>

            {selected && <div className="rounded-xl border p-5 sm:p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>2. 上傳設計圖稿</h2>
                <span className="rounded-md px-2 py-1 text-xs font-semibold" style={{ background: selected.is_accepting ? "var(--success-dim)" : "var(--danger-dim)", color: selected.is_accepting ? "var(--success)" : "var(--danger)" }}>
                  {selected.is_accepting ? "開放投稿中" : "目前未開放"}
                </span>
              </div>
              {!selected.is_accepting && <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>此品項目前未開放。開放時間：{formatDate(selected.effective_opens_at)}；截止時間：{formatDate(selected.effective_closes_at)}。</p>}
              <div className="mt-4"><UploadBox item={selected} files={files} onChange={setFiles} /></div>
            </div>}

            {selected && <div className="rounded-xl border p-5 sm:p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>3. 填寫投稿資料</h2>
              <div className="mt-4 space-y-4">
                {selected.custom_fields.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>這個品項不需額外填寫資料。</p>}
                {selected.custom_fields.map((field) => (
                  <label key={field.key} className="block">
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{field.label}{field.required && <span style={{ color: "var(--danger)" }}> *</span>}</span>
                    {field.field_type === "textarea" ? (
                      <textarea value={values[field.key] ?? ""} maxLength={field.max_length} placeholder={field.placeholder ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="input mt-2 min-h-28 w-full py-2" />
                    ) : (
                      <input value={values[field.key] ?? ""} maxLength={field.max_length} placeholder={field.placeholder ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="input mt-2 w-full" />
                    )}
                    {field.help_text && <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>{field.help_text}</span>}
                  </label>
                ))}
              </div>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" disabled={saving} onClick={() => void save(false)} className="btn btn-ghost min-h-11">儲存草稿</button>
                <button type="button" disabled={saving || !selected.is_accepting} onClick={() => void save(true)} className="btn min-h-11" style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                  {saving ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                  確認送出投稿
                </button>
              </div>
            </div>}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-5">
            {selected?.specification && <section className="rounded-xl border p-5" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>品項規格</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6" style={{ color: "var(--text-secondary)" }}>{selected.specification}</p></section>}
            {selected && <section className="rounded-xl border p-5" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>設計範本</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>請依範本範圍完成設計，可點擊圖片下載原圖。</p><div className="mt-4 grid grid-cols-2 gap-3">{selected.template_images.map((template) => <a key={template.url} href={uploadUrl(template.url)} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
              {/* 範本為管理員動態上傳的檔案，使用原始 URL 才能保留下載行為。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploadUrl(template.url)} alt={`${template.label} 範本`} className="aspect-square w-full object-contain" />
              <span className="mt-2 flex items-center justify-between gap-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{template.label}<Download size={14} aria-hidden="true" /></span></a>)}</div>{selected.template_images.length === 0 && <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>此品項尚未提供範本圖片。</p>}</section>}
            <section className="rounded-xl border p-5" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>我的投稿</h2><div className="mt-3 space-y-3">{submissions.length ? submissions.slice(0, 5).map((submission) => <div key={submission.id} className="border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--border)" }}><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{submission.item_name}</p><span className="text-xs font-medium" style={{ color: "var(--primary-text)" }}>{STATUS_LABEL[submission.status]}</span></div><p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}><Clock3 size={12} aria-hidden="true" />{formatDate(submission.submitted_at ?? submission.created_at)}</p>{submission.review_note && <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>{submission.review_note}</p>}</div>) : <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚未送出任何投稿。</p>}</div></section>
          </aside>
        </div>
      )}
    </main>
  );
}
