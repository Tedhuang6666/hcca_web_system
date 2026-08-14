"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, GripVertical, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage, partnerApplicationApi } from "@/lib/api";
import type {
  PartnerApplicationFieldConfig,
  PartnerApplicationFieldType,
  PartnerApplicationSettingsOut,
  PartnerBusinessApplicationOut,
  PartnerBusinessApplicationStatus,
} from "@/lib/types";

const STATUS_LABELS: Record<PartnerBusinessApplicationStatus, string> = {
  pending: "待處理",
  in_review: "審核中",
  needs_info: "待補件",
  approved: "已核准",
  rejected: "已退件",
};

const FIELD_TYPE_LABELS: Record<PartnerApplicationFieldType, string> = {
  text: "單行文字",
  textarea: "多行文字",
  email: "Email",
  tel: "電話",
  url: "網址",
  select: "下拉選單",
};

const EMPTY_FIELD: PartnerApplicationFieldConfig = {
  key: "new_field",
  label: "新欄位",
  field_type: "text",
  required: false,
  placeholder: null,
  help_text: null,
  options: [],
  sort_order: 100,
  is_active: true,
};

function toDraft(fields: PartnerApplicationSettingsOut["fields"]): PartnerApplicationFieldConfig[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    field_type: field.field_type,
    required: field.required,
    placeholder: field.placeholder,
    help_text: field.help_text,
    options: field.options,
    sort_order: field.sort_order,
    is_active: field.is_active,
  }));
}

function applicationTitle(application: PartnerBusinessApplicationOut): string {
  return (
    application.field_values.business_name ||
    Object.values(application.field_values).find((value) => value.trim()) ||
    "未命名申請"
  );
}

function applicationContact(application: PartnerBusinessApplicationOut): string {
  const email = application.field_values.contact_email;
  const name = application.field_values.contact_name;
  return [name, email].filter(Boolean).join(" · ") || "未提供聯絡資訊";
}

export default function PartnerApplicationsAdminPage() {
  const [settings, setSettings] = useState<PartnerApplicationSettingsOut | null>(null);
  const [fields, setFields] = useState<PartnerApplicationFieldConfig[]>([]);
  const [applications, setApplications] = useState<PartnerBusinessApplicationOut[]>([]);
  const [statusFilter, setStatusFilter] = useState<PartnerBusinessApplicationStatus | "">("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { status: PartnerBusinessApplicationStatus; note: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingReviewId, setSavingReviewId] = useState<string | null>(null);

  const loadApplications = useCallback(async (filter: PartnerBusinessApplicationStatus | "") => {
    const next = await partnerApplicationApi.adminList(filter);
    setApplications(next);
    setReviewDrafts((current) => {
      const merged = { ...current };
      for (const application of next) {
        merged[application.id] ??= {
          status: application.status,
          note: application.review_note ?? "",
        };
      }
      return merged;
    });
  }, []);

  useEffect(() => {
    Promise.all([partnerApplicationApi.adminSettings(), partnerApplicationApi.adminList("")])
      .then(([nextSettings, nextApplications]) => {
        setSettings(nextSettings);
        setFields(toDraft(nextSettings.fields));
        setApplications(nextApplications);
        setReviewDrafts(
          Object.fromEntries(nextApplications.map((application) => [application.id, {
            status: application.status,
            note: application.review_note ?? "",
          }])),
        );
      })
      .catch((error) => toast.error(apiErrorMessage(error, "載入特約商家申請管理失敗")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    loadApplications(statusFilter).catch((error) => toast.error(apiErrorMessage(error, "載入申請列表失敗")));
  }, [loadApplications, loading, statusFilter]);

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const saved = await partnerApplicationApi.updateSettings({
        is_open: settings.is_open,
        title: settings.title,
        intro: settings.intro,
        privacy_notice: settings.privacy_notice,
        fields,
      });
      setSettings(saved);
      setFields(toDraft(saved.fields));
      toast.success("申請表單設定已儲存");
    } catch (error) {
      toast.error(apiErrorMessage(error, "儲存表單設定失敗"));
    } finally {
      setSavingSettings(false);
    }
  };

  const updateField = (index: number, patch: Partial<PartnerApplicationFieldConfig>) => {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  };

  const saveReview = async (application: PartnerBusinessApplicationOut) => {
    const draft = reviewDrafts[application.id];
    if (!draft) return;
    setSavingReviewId(application.id);
    try {
      const saved = await partnerApplicationApi.review(application.id, {
        status: draft.status,
        review_note: draft.note || null,
      });
      setApplications((current) => current.map((item) => item.id === saved.id ? saved : item));
      toast.success("申請審核結果已儲存");
    } catch (error) {
      toast.error(apiErrorMessage(error, "儲存審核結果失敗"));
    } finally {
      setSavingReviewId(null);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl px-5 py-10 text-sm" style={{ color: "var(--text-muted)" }}>載入特約商家申請管理…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-5 py-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--primary)" }}>
            <ClipboardCheck size={18} aria-hidden />
            特約商家申請
          </div>
          <h1 className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>表單設定與審核</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>
            調整公開頁要收集的資料，再從同一頁處理商家的合作申請。Discord 頻道通知請到 Discord 管理的「特約商家申請送出」事件設定。
          </p>
        </div>
        <span className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: settings?.is_open ? "var(--success-dim)" : "var(--surface-hover)", color: settings?.is_open ? "var(--success)" : "var(--text-muted)" }}>
          {settings?.is_open ? "公開表單受理中" : "公開表單已關閉"}
        </span>
      </header>

      {settings ? (
        <section className="card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>公開表單設定</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>欄位調整儲存後，公開頁會立即套用新設定。</p>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={settings.is_open} onChange={(event) => setSettings((current) => current ? { ...current, is_open: event.target.checked } : current)} />
              開放商家申請
            </label>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="space-y-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>表單標題</span><input className="input w-full" value={settings.title} onChange={(event) => setSettings((current) => current ? { ...current, title: event.target.value } : current)} /></label>
            <label className="space-y-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>開頭說明</span><textarea className="input min-h-24 w-full" value={settings.intro} onChange={(event) => setSettings((current) => current ? { ...current, intro: event.target.value } : current)} /></label>
            <label className="space-y-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>個資/聯絡說明（選填）</span><textarea className="input min-h-20 w-full" placeholder="例如：資料僅用於特約合作聯繫與審核。" value={settings.privacy_notice ?? ""} onChange={(event) => setSettings((current) => current ? { ...current, privacy_notice: event.target.value || null } : current)} /></label>
          </div>

          <div className="mt-7 flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>申請欄位</h3><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>欄位代碼只接受小寫英數與底線，送出後可停用但不會刪除歷史資料。</p></div>
            <button className="btn btn-secondary shrink-0" onClick={() => setFields((current) => [...current, { ...EMPTY_FIELD, key: `field_${current.length + 1}`, sort_order: (current.length + 1) * 10 }])}><Plus size={15} aria-hidden />新增欄位</button>
          </div>
          <div className="mt-4 space-y-3">
            {fields.map((field, index) => (
              <div key={`${field.key}-${index}`} className="rounded-lg border p-4" style={{ borderColor: "var(--border)", opacity: field.is_active ? 1 : 0.6 }}>
                <div className="flex items-center gap-2"><GripVertical size={15} style={{ color: "var(--text-muted)" }} aria-hidden /><span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>欄位 {index + 1}</span><label className="ml-auto flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}><input type="checkbox" checked={field.is_active} onChange={(event) => updateField(index, { is_active: event.target.checked })} />啟用</label></div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_100px]">
                  <label className="space-y-1 text-xs"><span style={{ color: "var(--text-secondary)" }}>欄位名稱</span><input className="input w-full" value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /></label>
                  <label className="space-y-1 text-xs"><span style={{ color: "var(--text-secondary)" }}>欄位代碼</span><input className="input w-full font-mono" value={field.key} onChange={(event) => updateField(index, { key: event.target.value })} /></label>
                  <label className="space-y-1 text-xs"><span style={{ color: "var(--text-secondary)" }}>型別</span><select className="input w-full" value={field.field_type} onChange={(event) => updateField(index, { field_type: event.target.value as PartnerApplicationFieldType })}>{Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="space-y-1 text-xs"><span style={{ color: "var(--text-secondary)" }}>排序</span><input className="input w-full" type="number" min={0} value={field.sort_order} onChange={(event) => updateField(index, { sort_order: Number(event.target.value) })} /></label>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-xs"><span style={{ color: "var(--text-secondary)" }}>提示文字</span><input className="input w-full" placeholder="選填" value={field.placeholder ?? ""} onChange={(event) => updateField(index, { placeholder: event.target.value || null })} /></label>
                  <label className="space-y-1 text-xs"><span style={{ color: "var(--text-secondary)" }}>填寫說明</span><input className="input w-full" placeholder="選填" value={field.help_text ?? ""} onChange={(event) => updateField(index, { help_text: event.target.value || null })} /></label>
                </div>
                {field.field_type === "select" ? <label className="mt-3 block space-y-1 text-xs"><span style={{ color: "var(--text-secondary)" }}>下拉選項（用逗號分隔）</span><input className="input w-full" value={field.options?.join(", ") ?? ""} onChange={(event) => updateField(index, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} /></label> : null}
                <label className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />必填欄位</label>
              </div>
            ))}
          </div>
          <button className="btn btn-primary mt-5" disabled={savingSettings} onClick={() => void saveSettings()}><Save size={15} aria-hidden />{savingSettings ? "儲存中…" : "儲存表單設定"}</button>
        </section>
      ) : null}

      <section className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>申請審核</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>審核狀態與備註會保留在申請紀錄中。</p></div>
          <label className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}><span>篩選狀態</span><select className="input min-w-40" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as PartnerBusinessApplicationStatus | "")}><option value="">全部申請</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="mt-5 space-y-3">
          {applications.length === 0 ? <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>目前沒有符合條件的申請。</p> : applications.map((application) => {
            const draft = reviewDrafts[application.id] ?? { status: application.status, note: application.review_note ?? "" };
            return (
              <article key={application.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{applicationTitle(application)}</h3><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{applicationContact(application)} · {new Date(application.created_at).toLocaleString("zh-TW")}</p></div>
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>{STATUS_LABELS[application.status]}</span>
                </div>
                <details className="mt-4 rounded border p-3" style={{ borderColor: "var(--border)" }}><summary className="cursor-pointer text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>檢視申請內容</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(application.field_values).map(([key, value]) => <div key={key}><dt className="text-xs" style={{ color: "var(--text-muted)" }}>{fields.find((field) => field.key === key)?.label ?? key}</dt><dd className="mt-1 whitespace-pre-wrap text-sm" style={{ color: "var(--text-primary)" }}>{value || "（未填寫）"}</dd></div>)}</dl></details>
                <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
                  <label className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}><span>審核狀態</span><select className="input w-full" value={draft.status} onChange={(event) => setReviewDrafts((current) => ({ ...current, [application.id]: { ...draft, status: event.target.value as PartnerBusinessApplicationStatus } }))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}><span>審核備註</span><input className="input w-full" placeholder="例如：請補充合作優惠內容" value={draft.note} onChange={(event) => setReviewDrafts((current) => ({ ...current, [application.id]: { ...draft, note: event.target.value } }))} /></label>
                  <button className="btn btn-primary min-h-11" disabled={savingReviewId === application.id} onClick={() => void saveReview(application)}>{savingReviewId === application.id ? "儲存中…" : "儲存審核"}</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <p className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>Discord 通知設定：請至「管理 → Discord」，在模組通知路由新增「特約商家申請送出」，選擇指定伺服器與頻道即可。</p>
    </div>
  );
}
