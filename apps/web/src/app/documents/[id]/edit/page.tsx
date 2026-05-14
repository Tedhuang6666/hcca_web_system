"use client";
import { useEffect, useState, useCallback } from "react";
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

interface Recipient { id: string; recipient_type: RecipientType; name: string; email: string }

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
      await documentsApi.update(id, {
        title, urgency, classification, category,
        serial_template_id: selectedTemplateId || null,
        subject: subject || undefined, doc_description: docDescription || undefined,
        action_required: actionRequired || undefined,
        handler_name: handlerName || undefined, handler_unit: handlerUnit || undefined,
        handler_email: handlerEmail || undefined,
        due_date: dueDate || undefined, change_note: changeNote || undefined,
      });
      // 更新受文者（整批覆寫）
      await documentsRecipientsApi.update(id, recipients.map(r => ({
        recipient_type: r.recipient_type, name: r.name, email: r.email || undefined,
      })));
      toast.success("公文已更新");
      router.push(`/documents/${id}`);
    } catch (e) {
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
                  options: [["letter","函"],["decree","令"],["announcement","公告"],["report","報告"],["other","其他"]] },
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

          {/* 公文內容 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>公文內容（主旨／說明／辦法）</h3>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>一、主旨</label>
              <textarea value={subject} onChange={e => setSubject(e.target.value)} rows={2}
                placeholder="一句話概述目的，結尾用「請 鑒核」等語。"
                wrap="soft"
                className="w-full bg-transparent  text-sm p-2 rounded outline-none resize-y"
                style={{
                  ...inputStyle,
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  overflowX: "hidden",
                }} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>二、說明</label>
              <GongwenEditor value={docDescription} onChange={setDocDescription} minRows={5}
                placeholder="詳細說明事由、依據、背景資訊..." />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>三、辦法</label>
              <GongwenEditor value={actionRequired} onChange={setActionRequired} minRows={3}
                placeholder="具體請求事項或行動方案..." />
            </div>
          </div>

          {/* 受文者 */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>受文者</h3>
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
