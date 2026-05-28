"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  documentsApi, documentsRecipientsApi, serialTemplatesApi, ApiError,
} from "@/lib/api";
import type {
  DocumentOut, DocumentUrgency, DocumentClassification,
  DocumentCategory, RecipientType, SerialTemplateOut,
} from "@/lib/types";
import GongwenEditor from "@/components/ui/GongwenEditor";
import SmartTextarea from "@/components/ui/SmartTextarea";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import { useOnlineAutosave } from "@/hooks/useOnlineAutosave";

interface Recipient { id: string; recipient_type: RecipientType; name: string; email: string }

const CATEGORY_OPTIONS: Array<[DocumentCategory, string]> = [
  ["letter", "函"],
  ["decree", "令"],
  ["announcement", "公告"],
  ["report", "報告"],
  ["record", "紀錄"],
  ["consultation", "咨"],
  ["meeting_notice", "開會通知單"],
  ["other", "其他"],
];

const CONTENT_LABELS: Record<DocumentCategory, { title: string; subject?: string; desc: string; action?: string }> = {
  letter: { title: "公文內容（主旨／說明／辦法）", subject: "一、主旨", desc: "二、說明", action: "三、辦法" },
  decree: { title: "令文內容", desc: "正文" },
  announcement: { title: "公告內容", subject: "主旨", desc: "公告事項" },
  report: { title: "報告內容", subject: "主旨", desc: "說明／分析", action: "建議事項" },
  record: { title: "討論與決議", desc: "討論事項", action: "決議" },
  consultation: { title: "咨文內容", subject: "主旨", desc: "說明", action: "辦法或事項" },
  meeting_notice: { title: "議事日程", desc: "議事日程" },
  other: { title: "公文內容（主旨／說明／辦法）", subject: "一、主旨", desc: "二、說明", action: "三、辦法" },
};

type DocumentEditDraft = {
  title: string;
  urgency: DocumentUrgency;
  classification: DocumentClassification;
  category: DocumentCategory;
  subject: string;
  docDescription: string;
  actionRequired: string;
  meetingPurpose: string;
  meetingTime: string;
  meetingLocation: string;
  meetingChairperson: string;
  handlerName: string;
  handlerUnit: string;
  handlerEmail: string;
  dueDate: string;
  changeNote: string;
  recipients: Recipient[];
  newRecipient: { name: string; email: string; recipient_type: RecipientType };
  selectedTemplateId: string;
};

export default function EditDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 表單狀態
  const [title, setTitle] = useState("");
  const [urgency, setUrgency] = useState<DocumentUrgency>("normal");
  const [classification, setClassification] = useState<DocumentClassification>("normal");
  const [category, setCategory] = useState<DocumentCategory>("letter");
  const [subject, setSubject] = useState("");
  const [docDescription, setDocDescription] = useState("");
  const [actionRequired, setActionRequired] = useState("");
  const [meetingPurpose, setMeetingPurpose] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [meetingChairperson, setMeetingChairperson] = useState("");

  const [handlerName, setHandlerName] = useState("");
  const [handlerUnit, setHandlerUnit] = useState("");
  const [handlerEmail, setHandlerEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [newRecipient, setNewRecipient] = useState({ name: "", email: "", recipient_type: "main" as RecipientType });
  const [templates, setTemplates] = useState<SerialTemplateOut[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [doc, setDoc] = useState<DocumentOut | null>(null);
  const draftValue = useMemo<DocumentEditDraft>(() => ({
    title,
    urgency,
    classification,
    category,
    subject,
    docDescription,
    actionRequired,
    meetingPurpose,
    meetingTime,
    meetingLocation,
    meetingChairperson,
    handlerName,
    handlerUnit,
    handlerEmail,
    dueDate,
    changeNote,
    recipients,
    newRecipient,
    selectedTemplateId,
  }), [
    actionRequired,
    category,
    changeNote,
    classification,
    docDescription,
    dueDate,
    handlerEmail,
    handlerName,
    handlerUnit,
    meetingChairperson,
    meetingLocation,
    meetingPurpose,
    meetingTime,
    newRecipient,
    recipients,
    selectedTemplateId,
    subject,
    title,
    urgency,
  ]);
  const originalDraft = useMemo<DocumentEditDraft | null>(() => doc ? ({
    title: doc.title,
    urgency: doc.urgency,
    classification: doc.classification,
    category: doc.category,
      subject: doc.subject ?? "",
      docDescription: doc.doc_description ?? "",
      actionRequired: doc.action_required ?? "",
      meetingPurpose: doc.meeting_purpose ?? "",
      meetingTime: doc.meeting_time ? doc.meeting_time.slice(0, 16) : "",
      meetingLocation: doc.meeting_location ?? "",
      meetingChairperson: doc.meeting_chairperson ?? "",
      handlerName: doc.handler_name ?? "",
      handlerUnit: doc.handler_unit ?? "",
      handlerEmail: doc.handler_email ?? "",
    dueDate: doc.due_date ? doc.due_date.split("T")[0] : "",
    changeNote: "",
    recipients: doc.recipients.map(r => ({
      id: r.id,
      recipient_type: r.recipient_type,
      name: r.name,
      email: r.email ?? "",
    })),
    newRecipient: { name: "", email: "", recipient_type: "main" },
    selectedTemplateId: doc.serial_template_id ?? "",
  }) : null, [doc]);
  const restoreDraft = useCallback((draft: DocumentEditDraft) => {
    setTitle(draft.title ?? "");
    setUrgency(draft.urgency ?? "normal");
    setClassification(draft.classification ?? "normal");
    setCategory(draft.category ?? "letter");
    setSubject(draft.subject ?? "");
    setDocDescription(draft.docDescription ?? "");
    setActionRequired(draft.actionRequired ?? "");
    setMeetingPurpose(draft.meetingPurpose ?? "");
    setMeetingTime(draft.meetingTime ?? "");
    setMeetingLocation(draft.meetingLocation ?? "");
    setMeetingChairperson(draft.meetingChairperson ?? "");
    setHandlerName(draft.handlerName ?? "");
    setHandlerUnit(draft.handlerUnit ?? "");
    setHandlerEmail(draft.handlerEmail ?? "");
    setDueDate(draft.dueDate ?? "");
    setChangeNote(draft.changeNote ?? "");
    setRecipients(draft.recipients ?? []);
    setNewRecipient(draft.newRecipient ?? { name: "", email: "", recipient_type: "main" });
    setSelectedTemplateId(draft.selectedTemplateId ?? "");
    toast.info("已復原未儲存的公文編輯草稿");
  }, []);
  const { clearDraft, flushDraft, lastSavedAt } = useDraftAutosave({
    key: `documents:${id}:edit`,
    value: draftValue,
    onRestore: restoreDraft,
    enabled: Boolean(doc),
    isEmpty: useCallback((draft: DocumentEditDraft) => {
      if (!originalDraft) return true;
      if (!draft.newRecipient) return true;
      return JSON.stringify(draft) === JSON.stringify(originalDraft);
    }, [originalDraft]),
  });

  const buildUpdatePayload = useCallback((autosave = false) => ({
    title, urgency, classification, category,
    serial_template_id: selectedTemplateId || null,
    subject: category === "decree" ? null : subject || undefined,
    doc_description: docDescription || undefined,
    action_required: category === "decree" ? null : actionRequired || undefined,
    meeting_purpose: category === "meeting_notice" ? meetingPurpose || undefined : undefined,
    meeting_time: (category === "meeting_notice" || category === "record") && meetingTime ? meetingTime : undefined,
    meeting_location: (category === "meeting_notice" || category === "record") ? meetingLocation || undefined : undefined,
    meeting_chairperson: (category === "meeting_notice" || category === "record") ? meetingChairperson || undefined : undefined,
    handler_name: handlerName || undefined,
    handler_unit: handlerUnit || undefined,
    handler_email: handlerEmail || undefined,
    due_date: dueDate || undefined,
    change_note: autosave ? undefined : changeNote || undefined,
    autosave,
  }), [
    actionRequired,
    category,
    changeNote,
    classification,
    docDescription,
    dueDate,
    handlerEmail,
    handlerName,
    handlerUnit,
    meetingChairperson,
    meetingLocation,
    meetingPurpose,
    meetingTime,
    selectedTemplateId,
    subject,
    title,
    urgency,
  ]);

  const onlineAutosave = useOnlineAutosave({
    value: draftValue,
    enabled: Boolean(doc),
    isEmpty: useCallback((draft: DocumentEditDraft) => {
      if (!originalDraft) return true;
      return JSON.stringify(draft) === JSON.stringify(originalDraft);
    }, [originalDraft]),
    save: useCallback(async () => {
      await documentsApi.update(id, buildUpdatePayload(true));
      await documentsRecipientsApi.update(id, recipients.map(r => ({
        recipient_type: r.recipient_type,
        name: r.name,
        email: r.email || undefined,
      })));
    }, [buildUpdatePayload, id, recipients]),
  });

  const fetchDoc = useCallback(async () => {
    try {
      const d = await documentsApi.get(id);
      if (d.status !== "draft") {
        toast.error("只能編輯草稿狀態的公文");
        router.push(`/documents/${id}`);
        return;
      }
      setDoc(d);
      setTitle(d.title);
      setUrgency(d.urgency);
      setClassification(d.classification);
      setCategory(d.category);
      setSubject(d.subject ?? "");
      setDocDescription(d.doc_description ?? "");
      setActionRequired(d.action_required ?? "");
      setMeetingPurpose(d.meeting_purpose ?? "");
      setMeetingTime(d.meeting_time ? d.meeting_time.slice(0, 16) : "");
      setMeetingLocation(d.meeting_location ?? "");
      setMeetingChairperson(d.meeting_chairperson ?? "");

      setHandlerName(d.handler_name ?? "");
      setHandlerUnit(d.handler_unit ?? "");
      setHandlerEmail(d.handler_email ?? "");
      setDueDate(d.due_date ? d.due_date.split("T")[0] : "");
      setSelectedTemplateId(d.serial_template_id ?? "");
      setRecipients(d.recipients.map(r => ({
        id: r.id, recipient_type: r.recipient_type, name: r.name, email: r.email ?? "",
      })));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchDoc();
    const orgId = typeof window !== "undefined" ? localStorage.getItem("org_id") ?? "" : "";
    if (orgId) {
      serialTemplatesApi.list({ org_id: orgId, active_only: true })
        .then((rows) => {
          setTemplates(rows);
          setSelectedTemplateId((prev) => {
            if (prev && rows.some((row) => row.id === prev)) return prev;
            return rows.find((row) => row.is_default)?.id ?? rows[0]?.id ?? "";
          });
        })
        .catch(() => {});
    }
  }, [fetchDoc]);

  const addRecipient = () => {
    if (!newRecipient.name.trim()) return;
    setRecipients(prev => [...prev, { ...newRecipient, id: crypto.randomUUID() }]);
    setNewRecipient({ name: "", email: "", recipient_type: "main" });
  };

  const save = async () => {
    if (!title.trim()) { toast.error("請輸入公文標題"); return; }
    setSaving(true);
    try {
      await documentsApi.update(id, buildUpdatePayload(false));
      // 更新受文者（整批覆寫）
      await documentsRecipientsApi.update(id, recipients.map(r => ({
        recipient_type: r.recipient_type, name: r.name, email: r.email || undefined,
      })));
      clearDraft();
      toast.success("公文已更新");
      router.push(`/documents/${id}`);
    } catch (e) {
      flushDraft();
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally { setSaving(false); }
  };

  const uploadFile = async (file: File) => {
    setUploadingFile(true);
    try {
      await documentsApi.uploadAttachment(id, file);
      toast.success(`已上傳 ${file.name}`);
      fetchDoc();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "上傳失敗");
    } finally { setUploadingFile(false); }
  };

  const deleteAttachment = async (attId: string) => {
    try {
      await documentsApi.deleteAttachment(id, attId);
      toast.success("附件已刪除");
      fetchDoc();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "刪除失敗");
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64 ">載入中...</div>;
  if (!doc) return null;

  const selectStyle = { background: "var(--bg-elevated)", border: "1px solid var(--border)" };
  const inputStyle = { border: "1px solid var(--border)" };
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null;
  const isDecree = category === "decree";
  const isMeetingNotice = category === "meeting_notice";
  const isRecord = category === "record";
  const contentLabels = CONTENT_LABELS[category];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/documents/${id}`}
          className="w-8 h-8 rounded-lg flex items-center justify-center  hover:"
          style={{ border: "1px solid var(--border)" }}>←</Link>
        <div>
          <h1 className="text-xl font-semibold ">編輯公文</h1>
          <p className="text-sm font-mono" style={{ color: "var(--primary)" }}>
            {doc.serial_number || "（草稿，尚未發文）"}
          </p>
          {lastSavedAt && (
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              本機草稿已自動保存：{new Date(lastSavedAt).toLocaleTimeString("zh-TW")}
            </p>
          )}
          <p className="text-xs mt-1" style={{ color: onlineAutosave.status === "error" ? "var(--danger)" : "var(--text-muted)" }}>
            {onlineAutosave.status === "saving"
              ? "正在線上儲存..."
              : onlineAutosave.lastSavedAt
                ? `線上已儲存：${new Date(onlineAutosave.lastSavedAt).toLocaleTimeString("zh-TW")}`
                : onlineAutosave.status === "error"
                  ? onlineAutosave.error
                  : "編輯時會自動線上儲存草稿"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {/* 基本資訊 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>基本資訊</h3>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>公文標題 *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="輸入公文標題..."
                className="w-full bg-transparent  text-sm outline-none border-b pb-1"
                style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "速別", value: urgency, setter: setUrgency as (v: string) => void,
                  options: [["normal","普通件"],["priority","速件"],["express","最速件"]] },
                { label: "密等", value: classification, setter: setClassification as (v: string) => void,
                  options: [["normal","普通"],["confidential","機密"],["secret","秘密"]] },
                { label: "類別", value: category, setter: setCategory as (v: string) => void,
                  options: CATEGORY_OPTIONS },
              ].map(({ label, value, setter, options }) => (
                <div key={label}>
                  <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>{label}</label>
                  <select value={value} onChange={e => setter(e.target.value)}
                    className="w-full  text-xs outline-none rounded px-2 py-1.5" style={selectStyle}>
                    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {(isMeetingNotice || isRecord) && (
            <div className="card p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {isRecord ? "紀錄資訊" : "開會資訊"}
              </h3>
              {isMeetingNotice && (
                <input value={meetingPurpose} onChange={e => setMeetingPurpose(e.target.value)}
                  placeholder="開會事由"
                  className="w-full bg-transparent text-sm p-2 rounded outline-none" style={inputStyle} />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="datetime-local" value={meetingTime} onChange={e => setMeetingTime(e.target.value)}
                  className="w-full bg-transparent text-sm p-2 rounded outline-none" style={inputStyle} />
                <input value={meetingLocation} onChange={e => setMeetingLocation(e.target.value)}
                  placeholder={isRecord ? "地點" : "開會地點"}
                  className="w-full bg-transparent text-sm p-2 rounded outline-none" style={inputStyle} />
                <input value={meetingChairperson} onChange={e => setMeetingChairperson(e.target.value)}
                  placeholder={isRecord ? "主席" : "主持人"}
                  className="w-full bg-transparent text-sm p-2 rounded outline-none sm:col-span-2" style={inputStyle} />
              </div>
            </div>
          )}

          {/* 公文內容 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {contentLabels.title}
            </h3>
            {contentLabels.subject && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>{contentLabels.subject}</label>
                <SmartTextarea value={subject} onChange={setSubject} rows={2}
                  placeholder="一句話概述目的，結尾用「請 鑒核」等語。"
                  wrap="soft"
                  style={{
                    ...inputStyle,
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    overflowX: "hidden",
                  }} />
              </div>
            )}
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>
                {contentLabels.desc}
              </label>
              <GongwenEditor value={docDescription} onChange={setDocDescription} minRows={5}
                placeholder={isDecree
                  ? "茲修正發布「…」第…條條文，自即日生效。\n\n附修正條文1份。"
                  : "詳細說明事由、依據、背景資訊..."} />
            </div>
            {contentLabels.action && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>{contentLabels.action}</label>
                <GongwenEditor value={actionRequired} onChange={setActionRequired} minRows={3}
                  placeholder="具體請求事項或行動方案..." />
              </div>
            )}
          </div>

          {/* 受文者 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {isDecree ? "受文者（選填）" : "受文者"}
            </h3>
            {recipients.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <span className="px-1.5 py-0.5 rounded" style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
                  {{ main: "受文者", primary: "正本", copy: "副本" }[r.recipient_type]}
                </span>
                <span className=" flex-1">{r.name}</span>
                {r.email && <span style={{ color: "var(--text-muted)" }}>{r.email}</span>}
                <button onClick={() => setRecipients(prev => prev.filter(x => x.id !== r.id))}
                  className=" hover:text-red-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
            ))}
            <div className="flex gap-2">
              <select value={newRecipient.recipient_type}
                onChange={e => setNewRecipient(p => ({ ...p, recipient_type: e.target.value as RecipientType }))}
                className="text-xs px-2 py-1.5 rounded outline-none" style={{ ...selectStyle, color: "var(--primary)" }}>
                <option value="main">受文者</option>
                <option value="primary">正本</option>
                <option value="copy">副本</option>
              </select>
              <input placeholder="單位/姓名" value={newRecipient.name}
                onChange={e => setNewRecipient(p => ({ ...p, name: e.target.value }))}
                className="flex-1 bg-transparent  text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} />
              <input placeholder="Email（選填）" value={newRecipient.email}
                onChange={e => setNewRecipient(p => ({ ...p, email: e.target.value }))}
                className="flex-1 bg-transparent  text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} />
              <button onClick={addRecipient} className="text-xs px-3 py-1.5 rounded"
                style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                ＋ 新增
              </button>
            </div>
          </div>

          {/* 附件管理 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>附件</h3>
            {doc.attachments.length > 0 && (
              <ul className="space-y-2">
                {doc.attachments.map(a => (
                  <li key={a.id} className="flex items-center justify-between text-xs px-3 py-2 rounded"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-2 ">
                      <span>📎</span><span>{a.filename}</span>
                    </div>
                    <button onClick={() => deleteAttachment(a.id)} className=" hover:text-red-400 text-xs">
                      刪除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className={`flex items-center justify-center gap-2 py-3 rounded cursor-pointer border-dashed
              hover:opacity-80 transition-opacity text-xs ${uploadingFile ? "opacity-50 pointer-events-none" : ""}`}
              style={{ border: "2px dashed var(--border)", color: "var(--text-muted)" }}>
              <input type="file" className="hidden" disabled={uploadingFile}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              {uploadingFile ? "上傳中..." : "＋ 點擊上傳附件（PDF / 圖片 / ZIP，上限 20MB）"}
            </label>
          </div>
        </div>

        {/* 右側面板 */}
        <div className="space-y-4">
          {/* 字號模板 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>字號設定</h3>
            {templates.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>無可用字號模板</p>
            ) : (
              <>
                <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}
                  className="w-full  text-xs outline-none rounded px-2 py-1.5"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                  <option value="">── 使用通用格式 ──</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.org_prefix}{t.category_char}字{t.description ? ` — ${t.description}` : ""}
                    </option>
                  ))}
                </select>
                <div className="rounded-lg px-3 py-2.5 text-center"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)" }}>
                  <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>發文後字號預覽</p>
                  <p className="text-sm font-mono font-semibold" style={{ color: "var(--primary)" }}>
                    {selectedTemplate?.preview ?? `DOC-${new Date().getFullYear()}-XXXXXX`}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* 承辦人資訊 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>承辦人資訊</h3>
            {[
              { label: "姓名", value: handlerName, setter: setHandlerName, ph: "承辦人姓名" },
              { label: "單位", value: handlerUnit, setter: setHandlerUnit, ph: "所屬單位" },
              { label: "Email", value: handlerEmail, setter: setHandlerEmail, ph: "電子郵件" },
            ].map(({ label, value, setter, ph }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs w-10 flex-shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
                <input value={value} onChange={e => setter(e.target.value)} placeholder={ph}
                  className="flex-1 bg-transparent  text-xs px-2 py-1 rounded outline-none" style={inputStyle} />
              </div>
            ))}
          </div>

          {/* 限辦日期 */}
          <div className="card p-4">
            <label className="text-xs mb-2 block" style={{ color: "var(--text-muted)" }}>限辦日期</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full bg-transparent  text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} />
          </div>

          {/* 修訂備注 + 儲存 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>儲存</h3>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>修訂備注（選填）</label>
              <input value={changeNote} onChange={e => setChangeNote(e.target.value)}
                placeholder="說明本次修改原因..."
                className="w-full bg-transparent  text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} />
            </div>
            <button onClick={save} disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
              {saving ? "儲存中..." : "儲存變更"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
