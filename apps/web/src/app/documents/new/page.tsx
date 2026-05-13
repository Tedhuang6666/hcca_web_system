"use client";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { documentsApi, serialTemplatesApi, orgsApi, usersApi, ApiError } from "@/lib/api";
import type {
  DocumentUrgency, DocumentClassification, DocumentCategory,
  DocumentVisibility, RecipientType, SerialTemplateOut,
} from "@/lib/types";
import type { OrgRead, UserSummary } from "@/lib/api";
import GongwenEditor from "@/components/ui/GongwenEditor";

interface Recipient {
  id: string;
  recipient_type: RecipientType;
  name: string;
  email: string;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
      {children}{required && <span style={{ color: "var(--danger)" }} aria-hidden="true"> *</span>}
    </label>
  );
}

function RecipientSearch({
  onAdd, inputStyle, selectStyle,
  isMeetingNotice,
}: {
  onAdd: (r: { recipient_type: RecipientType; name: string; email: string }) => void;
  inputStyle: React.CSSProperties;
  selectStyle: React.CSSProperties;
  isMeetingNotice: boolean;
}) {
  const [type, setType] = useState<RecipientType>(isMeetingNotice ? "primary" : "main");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [suggestions, setSuggestions] = useState<UserSummary[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await usersApi.listForSearch(q);
        setSuggestions(results.slice(0, 8));
      } catch { setSuggestions([]); }
    }, 250);
  }, []);

  const selectUser = (u: UserSummary) => {
    setQuery(u.display_name); setEmail(u.email);
    setSuggestions([]); setShowDropdown(false);
  };

  const add = () => {
    if (!query.trim()) return;
    onAdd({ recipient_type: type, name: query.trim(), email: email.trim() });
    setQuery(""); setEmail(""); setSuggestions([]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <select value={type} onChange={e => setType(e.target.value as RecipientType)}
        style={{ ...selectStyle, width: "7rem", flexShrink: 0 }}>
        {isMeetingNotice ? (
          <>
            <option value="main">受文者</option>
            <option value="primary">正本（出席）</option>
            <option value="copy">副本（列席）</option>
          </>
        ) : (
          <>
            <option value="main">受文者</option>
            <option value="primary">正本</option>
            <option value="copy">副本</option>
          </>
        )}
      </select>
      <div className="relative flex-1" style={{ minWidth: "8rem" }}>
        <input
          placeholder={"單位 / 姓名 / 學號"}
          value={query}
          onChange={e => { setQuery(e.target.value); search(e.target.value); setShowDropdown(true); }}
          onKeyDown={e => { if (e.key === "Enter") add(); if (e.key === "Escape") setShowDropdown(false); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          style={{ ...inputStyle, width: "100%" }} />
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-lg"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            {suggestions.map(u => (
              <button key={u.id} type="button" onMouseDown={() => selectUser(u)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:opacity-80">
                <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                  style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                  {u.display_name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p style={{ color: "var(--text-primary)" }}>{u.display_name}</p>
                  <p className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>{u.email}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <input placeholder="Email（選填）" value={email} onChange={e => setEmail(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") add(); }} type="email"
        style={{ ...inputStyle, flex: "1", minWidth: "8rem" }} />
      <button onClick={add} type="button" className="btn btn-ghost flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新增
      </button>
    </div>
  );
}

const CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: "letter",         label: "函"       },
  { value: "decree",         label: "令"       },
  { value: "announcement",   label: "公告"     },
  { value: "report",         label: "報告"     },
  { value: "meeting_notice", label: "開會通知單" },
  { value: "other",          label: "其他"     },
];

export default function NewDocumentPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [urgency, setUrgency] = useState<DocumentUrgency>("normal");
  const [classification, setClassification] = useState<DocumentClassification>("normal");
  const [subject, setSubject] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState<DocumentCategory>("letter");
  const isMeetingNotice = category === "meeting_notice";
  const docType = CATEGORY_OPTIONS.find(o => o.value === category)?.label ?? "";

  // 組織列表
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const selectedOrg = orgs.find(o => o.id === selectedOrgId) ?? null;

  // 自動標題
  const autoTitle = useMemo(() => {
    const parts = [selectedOrg?.name, docType.trim()].filter(Boolean);
    return parts.join(" ");
  }, [selectedOrg, docType]);

  const fieldError = {
    org:     !selectedOrgId                          ? "請選擇發文組織" : "",
    subject: !isMeetingNotice && !subject.trim()     ? "主旨為必填"     : "",
  };
  const hasErrors = Object.values(fieldError).some(Boolean);
  const markTouched = (key: string) => setTouched(p => ({ ...p, [key]: true }));
  const showErr = (key: string) => touched[key] && fieldError[key as keyof typeof fieldError];

  const [docDescription, setDocDescription] = useState("");
  const [actionRequired, setActionRequired] = useState("");

  // 開會通知單專屬欄位
  const [meetingPurpose, setMeetingPurpose] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [meetingChairperson, setMeetingChairperson] = useState("");

  // 承辦人（從個人資料自動填入）
  const [handlerName, setHandlerName] = useState("");
  const [handlerUnit, setHandlerUnit] = useState("");
  const [handlerEmail, setHandlerEmail] = useState("");
  const [showEmail, setShowEmail] = useState(true);

  const [dueDate, setDueDate] = useState("");
  const [visibilityLevel, setVisibilityLevel] = useState<DocumentVisibility>("org_only");
  const [recipients, setRecipients] = useState<Recipient[]>([]);

  // 連結附件（草稿建立後逐一新增）
  interface LinkDraft { id: string; url: string; display_text: string }
  const [pendingLinks, setPendingLinks] = useState<LinkDraft[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [newLink, setNewLink] = useState({ url: "", display_text: "" });
  const addPendingLink = () => {
    if (!newLink.url.trim()) return;
    setPendingLinks(p => [...p, { id: crypto.randomUUID(), ...newLink }]);
    setNewLink({ url: "", display_text: "" });
  };
  const [templates, setTemplates] = useState<SerialTemplateOut[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  // 載入使用者資料與組織
  useEffect(() => {
    orgsApi.myCreateOrgs().then(setOrgs).catch(() => {});
    const storedOrgId = typeof window !== "undefined" ? (localStorage.getItem("org_id") ?? "") : "";
    if (storedOrgId) setSelectedOrgId(storedOrgId);

    // 從個人資料自動填入承辦人
    usersApi.me().then(u => {
      setHandlerName(u.display_name ?? "");
      if (u.show_email) setHandlerEmail(u.email ?? "");
      setShowEmail(u.show_email ?? true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedOrgId) { setTemplates([]); setSelectedTemplateId(""); return; }
    serialTemplatesApi
      .list({ org_id: selectedOrgId, active_only: true })
      .then(ts => {
        setTemplates(ts);
        setSelectedTemplateId((prev) => {
          if (prev && ts.some((item) => item.id === prev)) return prev;
          return ts.find((item) => item.is_default)?.id ?? ts[0]?.id ?? "";
        });
      })
      .catch(() => {});
  }, [selectedOrgId]);


  const save = async () => {
    setTouched({ org: true, subject: true });
    if (hasErrors) { toast.error("請填寫必填欄位"); return; }
    setSaving(true);
    try {
      const doc = await documentsApi.create({
        title: autoTitle, urgency, classification, category,
        serial_template_id: selectedTemplateId || null,
        subject: subject || undefined,
        doc_description: docDescription || undefined,
        action_required: actionRequired || undefined,
        meeting_purpose: category === "meeting_notice" ? (meetingPurpose || undefined) : undefined,
        meeting_time: category === "meeting_notice" && meetingTime ? meetingTime : undefined,
        meeting_location: category === "meeting_notice" ? (meetingLocation || undefined) : undefined,
        meeting_chairperson: category === "meeting_notice" ? (meetingChairperson || undefined) : undefined,
        handler_name: handlerName || undefined,
        handler_unit: handlerUnit || undefined,
        handler_email: showEmail ? (handlerEmail || undefined) : undefined,
        due_date: dueDate || undefined,
        visibility_level: visibilityLevel,
        org_id: selectedOrgId,
        recipients: recipients.map((r) => ({
          recipient_type: r.recipient_type,
          name: r.name,
          email: r.email || undefined,
        })),
      });
      for (const lnk of pendingLinks) {
        await documentsApi.addLink(doc.id, { url: lnk.url, display_text: lnk.display_text || undefined });
      }
      for (const file of pendingFiles) {
        await documentsApi.uploadAttachment(doc.id, file);
      }
      toast.success("草稿已儲存");
      router.push(`/documents/${encodeURIComponent(doc.serial_number)}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
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

  const selectStyle = { ...inputStyle, cursor: "pointer" } as React.CSSProperties;

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* 頁首 */}
      <div className="flex items-center gap-3">
        <Link href="/documents" className="topbar-icon-btn" aria-label="返回公文列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>新增公文</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            建立草稿後可隨時修改，確認後再送審
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 主欄 */}
        <div className="lg:col-span-2 space-y-4">

          <FormSection title="基本資訊">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label required>發文組織</Label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => { setSelectedOrgId(e.target.value); markTouched("org"); }}
                  onBlur={() => markTouched("org")}
                  style={showErr("org")
                    ? { ...selectStyle, border: "1px solid var(--danger)" }
                    : selectStyle}>
                  <option value="">選擇組織…</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                {showErr("org") && (
                  <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.org}</p>
                )}
              </div>
              <div>
                <Label required>公文類別</Label>
                <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                  style={selectStyle}>
                  {CATEGORY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 標題預覽 */}
            {autoTitle && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>公文標題：</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {autoTitle}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "速別", value: urgency,
                  setter: (v: string) => setUrgency(v as DocumentUrgency),
                  options: [["normal","普通件"],["priority","速件"],["express","最速件"]],
                },
                {
                  label: "密等", value: classification,
                  setter: (v: string) => setClassification(v as DocumentClassification),
                  options: [["normal","普通"],["confidential","機密"],["secret","秘密"]],
                },
              ].map(({ label, value, setter, options }) => (
                <div key={label}>
                  <Label>{label}</Label>
                  <select value={value} onChange={(e) => setter(e.target.value)} style={selectStyle}>
                    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </FormSection>

          {/* 開會通知單專屬 */}
          {isMeetingNotice && (
            <FormSection title="開會資訊">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Label>開會事由</Label>
                  <input value={meetingPurpose} onChange={e => setMeetingPurpose(e.target.value)}
                    placeholder="例：班級聯合自治會第1屆學生代表團第3次會議" style={inputStyle} />
                </div>
                <div>
                  <Label>開會時間</Label>
                  <input type="datetime-local" value={meetingTime}
                    onChange={e => setMeetingTime(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <Label>開會地點</Label>
                  <input value={meetingLocation} onChange={e => setMeetingLocation(e.target.value)}
                    placeholder="例：班聯會辦公室" style={inputStyle} />
                </div>
                <div className="sm:col-span-2">
                  <Label>主持人</Label>
                  <input value={meetingChairperson} onChange={e => setMeetingChairperson(e.target.value)}
                    placeholder="例：楊總召千霆" style={inputStyle} />
                </div>
              </div>
            </FormSection>
          )}

          {/* 公文主體 */}
          <FormSection title={isMeetingNotice ? "議事日程" : "公文內容"}>
            {/* 主旨（開會通知單不顯示） */}
            {!isMeetingNotice && (
              <div>
                <Label required>主旨</Label>
                <textarea
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  onBlur={() => markTouched("subject")}
                  rows={2}
                  wrap="soft"
                  placeholder="一句話概述目的，結尾用「請　鑒核」等語"
                  style={showErr("subject")
                    ? {
                        ...inputStyle,
                        border: "1px solid var(--danger)",
                        resize: "vertical",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        overflowX: "hidden",
                      }
                    : {
                        ...inputStyle,
                        resize: "vertical",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        overflowX: "hidden",
                      }}
                />
                {showErr("subject") && (
                  <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.subject}</p>
                )}
              </div>
            )}
            <div>
              <Label>
                {isMeetingNotice ? "議事日程" : "說明"}
                <span className="ml-2 font-normal opacity-60 text-[10px]">
                  Tab 降級 ／ Shift+Tab 升級 ／ Enter 續編
                </span>
              </Label>
              <GongwenEditor
                value={docDescription}
                onChange={setDocDescription}
                minRows={6}
                placeholder={isMeetingNotice
                  ? "一、審查「…」案。\n二、討論「…」案。\n三、臨時動議。"
                  : "一、說明事由…\n　　（一）依據：\n　　（二）辦理進度：\n　　　　1. 第一階段…"}
              />
            </div>
            {/* 辦法（開會通知單不顯示） */}
            {!isMeetingNotice && (
              <div>
                <Label>辦法</Label>
                <GongwenEditor
                  value={actionRequired}
                  onChange={setActionRequired}
                  minRows={3}
                  placeholder="一、具體請求事項…"
                />
              </div>
            )}
          </FormSection>

          {/* 受文者 / 出席者 */}
          <FormSection title={isMeetingNotice ? "受文者 / 正本（出席） / 副本（列席）" : "受文者"}>
            {recipients.length > 0 && (
              <ul className="space-y-1.5">
                {recipients.map((r) => (
                  <li key={r.id}
                    className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <span className="badge text-[10px] flex-shrink-0"
                      style={{ color: "var(--primary)", background: "var(--primary-dim)", borderColor: "var(--primary-dim)" }}>
                      {isMeetingNotice
                        ? { main: "受文者", primary: "正本（出席）", copy: "副本（列席）" }[r.recipient_type] ?? r.recipient_type
                        : { main: "受文者", primary: "正本", copy: "副本" }[r.recipient_type] ?? r.recipient_type}
                    </span>
                    <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{r.name}</span>
                    {r.email && (
                      <span className="truncate max-w-32" style={{ color: "var(--text-muted)" }}>{r.email}</span>
                    )}
                    <button onClick={() => setRecipients((p) => p.filter((x) => x.id !== r.id))}
                      className="flex-shrink-0 transition-colors hover:text-red-500"
                      style={{ color: "var(--text-muted)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <RecipientSearch
              onAdd={(r) => setRecipients(p => [...p, { ...r, id: crypto.randomUUID() }])}
              inputStyle={inputStyle}
              selectStyle={selectStyle}
              isMeetingNotice={isMeetingNotice}
            />
          </FormSection>

          {/* 連結附件 */}
          <FormSection title="連結附件">
            {pendingLinks.length > 0 && (
              <ul className="space-y-1.5">
                {pendingLinks.map(lnk => (
                  <li key={lnk.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" style={{ color: "var(--primary)", flexShrink: 0 }}>
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                      {lnk.display_text || lnk.url}
                    </span>
                    <span className="truncate max-w-40 text-[10px]" style={{ color: "var(--text-muted)" }}>{lnk.url}</span>
                    <button onClick={() => setPendingLinks(p => p.filter(x => x.id !== lnk.id))}
                      className="flex-shrink-0 transition-colors hover:text-red-500"
                      style={{ color: "var(--text-muted)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <input placeholder="連結網址 https://…" value={newLink.url}
                onChange={e => setNewLink(p => ({ ...p, url: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") addPendingLink(); }}
                style={{ ...inputStyle, flex: "2", minWidth: "12rem" }} />
              <input placeholder="顯示名稱（選填）" value={newLink.display_text}
                onChange={e => setNewLink(p => ({ ...p, display_text: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") addPendingLink(); }}
                style={{ ...inputStyle, flex: "1", minWidth: "8rem" }} />
              <button onClick={addPendingLink} className="btn btn-ghost flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                新增
              </button>
            </div>
            <div className="pt-2">
              <Label>檔案附件</Label>
              <label className="block text-xs px-3 py-2 rounded-lg cursor-pointer"
                style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}>
                <input
                  type="file"
                  className="hidden"
                  onChange={e => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) setPendingFiles(prev => [...prev, ...files]);
                    e.target.value = "";
                  }}
                />
                ＋ 選擇附件（建立草稿後自動上傳）
              </label>
              {pendingFiles.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {pendingFiles.map((file, idx) => (
                    <li key={`${file.name}-${idx}`} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                      <span className="truncate" style={{ color: "var(--text-primary)" }}>{file.name}</span>
                      <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                        style={{ color: "var(--danger)" }}>
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FormSection>
        </div>

        {/* 右欄 */}
        <div className="space-y-4">

          {/* 字號模板 */}
          <FormSection title="字號設定">
            {!selectedOrgId ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>請先選擇發文組織</p>
            ) : templates.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>此組織目前無可用字號模板</p>
            ) : (
              <>
                <div>
                  <Label>選擇字號前綴</Label>
                  <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}
                    style={selectStyle}>
                    <option value="">── 使用通用格式 ──</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.org_prefix}{t.category_char}字
                        {t.description ? ` — ${t.description}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-xl px-4 py-3 text-center"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                  <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>發文後字號預覽</p>
                  <p className="text-sm font-mono font-bold" style={{ color: "var(--primary)" }}>
                    {selectedTemplate ? selectedTemplate.preview : `DOC-${new Date().getFullYear()}-XXXXXX`}
                  </p>
                </div>
              </>
            )}
          </FormSection>

          {/* 可見度 */}
          <FormSection title="可見度">
            <select value={visibilityLevel}
              onChange={e => setVisibilityLevel(e.target.value as DocumentVisibility)}
              style={selectStyle}>
              <option value="org_only">機關成員可見</option>
              <option value="subject_only">僅當事人（建立者＋審核人）</option>
              <option value="public">全體登入使用者</option>
              <option value="publicly_open">完全公開（含未登入）</option>
            </select>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              控制哪些人可以查閱此公文
            </p>
          </FormSection>

          {/* 儲存 */}
          <div className="card p-4 space-y-3">
            <button onClick={save} disabled={saving} className="btn btn-primary w-full" aria-busy={saving}>
              {saving ? "儲存中…" : "儲存草稿"}
            </button>
            {Object.keys(touched).length > 0 && hasErrors && (
              <p className="text-xs text-center" style={{ color: "var(--danger)" }}>請填寫所有必填欄位</p>
            )}
            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              儲存後可在詳情頁設定審核人並送審
            </p>
          </div>

          {/* 承辦人 */}
          <FormSection title="承辦人資訊">
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              從個人資料自動帶入，可手動修改
            </p>
            {[
              { label: "姓名", value: handlerName, setter: setHandlerName, ph: "承辦人姓名" },
              { label: "單位", value: handlerUnit, setter: setHandlerUnit, ph: "所屬單位" },
            ].map(({ label, value, setter, ph }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs w-12 flex-shrink-0 font-medium" style={{ color: "var(--text-muted)" }}>
                  {label}
                </span>
                <input value={value} onChange={(e) => setter(e.target.value)} placeholder={ph}
                  style={{ ...inputStyle, fontSize: "0.75rem" }} />
              </div>
            ))}
            {/* Email + 顯示切換 */}
            <div className="flex items-center gap-3">
              <span className="text-xs w-12 flex-shrink-0 font-medium" style={{ color: "var(--text-muted)" }}>
                Email
              </span>
              <input value={handlerEmail} onChange={(e) => setHandlerEmail(e.target.value)}
                placeholder="電子郵件" type="email"
                style={{ ...inputStyle, flex: 1, fontSize: "0.75rem" }} />
              <div className="flex items-center gap-1.5 flex-shrink-0" title="顯示於公文上">
                <button role="switch" aria-checked={showEmail} onClick={() => setShowEmail(p => !p)}
                  className="relative w-8 h-4 rounded-full transition-colors overflow-hidden"
                  style={{ background: showEmail ? "var(--primary)" : "var(--border-strong)" }}>
                  <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                    style={{ transform: showEmail ? "translateX(16px)" : "translateX(2px)" }} />
                </button>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>顯示</span>
              </div>
            </div>
          </FormSection>

          {/* 限辦日期 */}
          <div className="card p-4">
            <Label>限辦日期</Label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              style={inputStyle} />
          </div>
        </div>
      </div>
    </div>
  );
}
