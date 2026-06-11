"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { documentTemplatesApi, orgsApi, apiErrorMessage } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import type {
  DocumentCategory,
  DocumentClassification,
  DocumentTemplateCreate,
  DocumentTemplateOut,
  DocumentUrgency,
  DocumentVisibility,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";

const CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: "letter", label: "函" },
  { value: "decree", label: "令" },
  { value: "announcement", label: "公告" },
  { value: "report", label: "報告" },
  { value: "record", label: "紀錄" },
  { value: "consultation", label: "咨" },
  { value: "meeting_notice", label: "開會通知單" },
  { value: "other", label: "其他" },
];

const EMPTY_FORM: DocumentTemplateCreate = {
  org_id: "",
  name: "",
  description: null,
  issuer_full_name: null,
  urgency: "normal",
  classification: "normal",
  declassification_condition: "none",
  category: "letter",
  subject: "",
  doc_description: "",
  action_required: "",
  content: "",
  meeting_purpose: null,
  meeting_location: null,
  meeting_chairperson: null,
  handler_unit: null,
  file_number: null,
  retention_period: null,
  visibility_level: "org_only",
  recipients: [],
};

function cleanForm(form: DocumentTemplateCreate): DocumentTemplateCreate {
  return {
    ...form,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    issuer_full_name: form.issuer_full_name?.trim() || null,
    subject: form.subject?.trim() || null,
    doc_description: form.doc_description?.trim() || null,
    action_required: form.action_required?.trim() || null,
    content: form.content?.trim() || "",
    meeting_purpose: form.meeting_purpose?.trim() || null,
    meeting_location: form.meeting_location?.trim() || null,
    meeting_chairperson: form.meeting_chairperson?.trim() || null,
    handler_unit: form.handler_unit?.trim() || null,
    file_number: form.file_number?.trim() || null,
    retention_period: form.retention_period?.trim() || null,
  };
}

export default function DocumentTemplatesPage() {
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplateOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [form, setForm] = useState<DocumentTemplateCreate>(EMPTY_FORM);

  const selectedOrg = useMemo(
    () => orgs.find((item) => item.id === form.org_id) ?? null,
    [form.org_id, orgs],
  );

  const loadTemplates = useCallback(() => {
    setLoading(true);
    documentTemplatesApi
      .list({
        org_id: orgFilter || undefined,
        keyword: keyword.trim() || undefined,
        active_only: activeOnly,
      })
      .then(setTemplates)
      .catch((e) => toast.error(apiErrorMessage(e, "載入公文範本失敗")))
      .finally(() => setLoading(false));
  }, [activeOnly, keyword, orgFilter]);

  useEffect(() => {
    orgsApi.myCreateOrgs().then(setOrgs).catch(() => {});
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, org_id: orgFilter });
  };

  const editTemplate = (item: DocumentTemplateOut) => {
    setEditingId(item.id);
    setForm({
      org_id: item.org_id,
      name: item.name,
      description: item.description,
      issuer_full_name: item.issuer_full_name,
      urgency: item.urgency,
      classification: item.classification,
      declassification_condition: item.declassification_condition,
      category: item.category,
      subject: item.subject,
      doc_description: item.doc_description,
      action_required: item.action_required,
      content: item.content,
      meeting_purpose: item.meeting_purpose,
      meeting_location: item.meeting_location,
      meeting_chairperson: item.meeting_chairperson,
      handler_unit: item.handler_unit,
      file_number: item.file_number,
      retention_period: item.retention_period,
      visibility_level: item.visibility_level,
      recipients: item.recipients,
    });
  };

  const save = async () => {
    if (!form.org_id || !form.name.trim()) {
      toast.error("請選擇組織並填寫範本名稱");
      return;
    }
    if (
      form.category !== "meeting_notice"
      && form.category !== "decree"
      && form.category !== "record"
      && !form.subject?.trim()
    ) {
      toast.error("此類公文範本需填寫主旨");
      return;
    }
    if (form.category === "record" && (!form.doc_description || !form.action_required)) {
      toast.error("紀錄範本需填寫討論事項與決議");
      return;
    }
    if (form.category === "meeting_notice" && (!form.meeting_purpose || !form.meeting_location)) {
      toast.error("開會通知單範本需填寫事由與地點");
      return;
    }
    setSaving(true);
    try {
      const payload = cleanForm(form);
      if (payload.category === "decree") {
        payload.subject = null;
        payload.action_required = null;
      }
      if (editingId) {
        await documentTemplatesApi.update(editingId, payload);
        toast.success("公文範本已更新");
      } else {
        await documentTemplatesApi.create(payload);
        toast.success("公文範本已建立");
      }
      resetForm();
      loadTemplates();
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存公文範本失敗"));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (item: DocumentTemplateOut) => {
    if (!confirm(`停用公文範本「${item.name}」？`)) return;
    try {
      await documentTemplatesApi.deactivate(item.id);
      toast.success("公文範本已停用");
      loadTemplates();
    } catch (e) {
      toast.error(apiErrorMessage(e, "停用失敗"));
    }
  };

  const inputStyle = {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    borderRadius: "8px",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    width: "100%",
    outline: "none",
  } as React.CSSProperties;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">公文範本庫</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            維護常用公文內容，起稿時可一鍵帶入主旨、說明、辦法與受文者。
          </p>
        </div>
        <Link href="/documents/new" className="btn btn-primary">
          新增公文
        </Link>
      </header>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div className="card p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} style={inputStyle}>
                <option value="">全部可用組織</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜尋範本名稱、說明、主旨"
                style={inputStyle}
              />
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                  className="accent-blue-600"
                />
                僅有效
              </label>
            </div>
          </div>

          {loading ? (
            <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
          ) : templates.length === 0 ? (
            <SmartEmptyState reason="filtered" subject="公文範本" message="尚無符合條件的範本，請調整篩選或新增" />
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {templates.map((item) => (
                <article key={item.id} className="card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{item.name}</h2>
                        <span className="badge text-[10px]">
                          {CATEGORY_OPTIONS.find((cat) => cat.value === item.category)?.label ?? item.category}
                        </span>
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          v{item.version}
                        </span>
                        {!item.is_active && (
                          <span className="text-[10px]" style={{ color: "var(--danger)" }}>已停用</span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                        {item.subject || item.meeting_purpose || item.doc_description || "未填內容"}
                      </p>
                      {item.description && (
                        <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-muted)" }}>
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/documents/new?template_id=${item.id}`} className="btn btn-primary">
                        使用
                      </Link>
                      <button className="btn btn-ghost" onClick={() => editTemplate(item)}>
                        編輯
                      </button>
                      {item.is_active && (
                        <button className="btn btn-danger" onClick={() => deactivate(item)}>
                          停用
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="card h-fit p-4">
          <h2 className="text-sm font-semibold">{editingId ? "編輯範本" : "新增範本"}</h2>
          <div className="mt-4 space-y-3">
            <select
              value={form.org_id}
              onChange={(e) => setForm((prev) => ({ ...prev, org_id: e.target.value }))}
              style={inputStyle}
              disabled={!!editingId}
            >
              <option value="">選擇組織</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="範本名稱"
              style={inputStyle}
            />
            <textarea
              value={form.description ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="範本說明"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <select
              value={form.category}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as DocumentCategory }))}
              style={inputStyle}
            >
              {CATEGORY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.urgency}
                onChange={(e) => setForm((prev) => ({ ...prev, urgency: e.target.value as DocumentUrgency }))}
                style={inputStyle}
              >
                <option value="normal">普通件</option>
                <option value="priority">速件</option>
                <option value="express">最速件</option>
              </select>
              <select
                value={form.classification}
                onChange={(e) => setForm((prev) => ({ ...prev, classification: e.target.value as DocumentClassification }))}
                style={inputStyle}
              >
                <option value="normal">普通</option>
                <option value="confidential">機密</option>
                <option value="secret">秘密</option>
              </select>
            </div>
            {form.category === "meeting_notice" ? (
              <>
                <textarea
                  value={form.meeting_purpose ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, meeting_purpose: e.target.value }))}
                  placeholder="開會事由"
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
                <input
                  value={form.meeting_location ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, meeting_location: e.target.value }))}
                  placeholder="開會地點"
                  style={inputStyle}
                />
              </>
            ) : form.category === "decree" || form.category === "record" ? null : (
              <textarea
                value={form.subject ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                placeholder="主旨"
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            )}
            <textarea
              value={form.doc_description ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, doc_description: e.target.value }))}
              placeholder={
                form.category === "meeting_notice"
	                  ? "議事日程"
	                  : form.category === "decree"
	                    ? "令文正文"
	                    : form.category === "record"
	                      ? "討論事項"
	                      : form.category === "announcement"
	                        ? "公告事項"
	                        : form.category === "report"
	                          ? "說明／分析"
	                          : "說明"
              }
              rows={5}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            {form.category !== "meeting_notice" && form.category !== "decree" && (
              <textarea
                value={form.action_required ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, action_required: e.target.value }))}
                placeholder={
                  form.category === "record"
                    ? "決議"
                    : form.category === "report"
                      ? "建議事項"
                      : form.category === "consultation"
                        ? "辦法或事項"
                        : "辦法"
                }
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            )}
            <input
              value={form.handler_unit ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, handler_unit: e.target.value }))}
              placeholder="預設承辦單位"
              style={inputStyle}
            />
            <select
              value={form.visibility_level}
              onChange={(e) => setForm((prev) => ({ ...prev, visibility_level: e.target.value as DocumentVisibility }))}
              style={inputStyle}
            >
              <option value="org_only">機關成員可見</option>
              <option value="subject_only">僅當事人</option>
              <option value="public">全體登入使用者</option>
              <option value="publicly_open">完全公開</option>
            </select>
            {selectedOrg && (
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                所屬組織：{selectedOrg.name}
              </p>
            )}
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" disabled={saving} onClick={save}>
                {saving ? "儲存中" : editingId ? "更新範本" : "建立範本"}
              </button>
              <button className="btn btn-ghost" disabled={saving} onClick={resetForm}>
                清空
              </button>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
