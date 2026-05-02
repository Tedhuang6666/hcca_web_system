"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { documentsApi, ApiError } from "@/lib/api";
import type { DocumentUrgency, DocumentClassification, DocumentCategory, RecipientType } from "@/lib/types";

interface Recipient { id: string; recipient_type: RecipientType; name: string; email: string }

export default function NewDocumentPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [urgency, setUrgency] = useState<DocumentUrgency>("normal");
  const [classification, setClassification] = useState<DocumentClassification>("normal");
  const [category, setCategory] = useState<DocumentCategory>("letter");
  const [subject, setSubject] = useState("");
  const [docDescription, setDocDescription] = useState("");
  const [actionRequired, setActionRequired] = useState("");
  const [issuerOrgName, setIssuerOrgName] = useState("");
  const [handlerName, setHandlerName] = useState("");
  const [handlerUnit, setHandlerUnit] = useState("");
  const [handlerPhone, setHandlerPhone] = useState("");
  const [handlerEmail, setHandlerEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [newRecipient, setNewRecipient] = useState({ name: "", email: "", recipient_type: "main" as RecipientType });

  const addRecipient = () => {
    if (!newRecipient.name.trim()) return;
    setRecipients(prev => [...prev, { ...newRecipient, id: crypto.randomUUID() }]);
    setNewRecipient({ name: "", email: "", recipient_type: "main" });
  };

  const save = async () => {
    if (!title.trim()) { toast.error("請輸入公文標題"); return; }
    setSaving(true);
    try {
      const orgId = localStorage.getItem("org_id") ?? "";
      const doc = await documentsApi.create({
        title, urgency, classification, category,
        subject: subject || undefined, doc_description: docDescription || undefined,
        action_required: actionRequired || undefined, issuer_org_name: issuerOrgName || undefined,
        handler_name: handlerName || undefined, handler_unit: handlerUnit || undefined,
        handler_phone: handlerPhone || undefined, handler_email: handlerEmail || undefined,
        due_date: dueDate || undefined, org_id: orgId,
        recipients: recipients.map(r => ({ recipient_type: r.recipient_type, name: r.name, email: r.email || undefined })),
      });
      toast.success("草稿已儲存");
      router.push(`/documents/${doc.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally { setSaving(false); }
  };

  const selectStyle = { background: "var(--bg-elevated)", border: "1px solid var(--border)" };
  const inputStyle = { border: "1px solid var(--border)" };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/documents" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200"
          style={{ border: "1px solid var(--border)" }}>←</Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-100">新增公文</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>建立草稿後可隨時修改，確認後再送審</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {/* 基本資訊 */}
          <div className="glass p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>基本資訊</h3>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>公文標題 *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="輸入公文標題..."
                className="w-full bg-transparent text-slate-100 text-sm outline-none border-b pb-1"
                style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "速別", value: urgency, setter: (v: string) => setUrgency(v as DocumentUrgency),
                  options: [["normal","普通"],["urgent","速件"],["most_urgent","最速件"],["flash","閃電件"]] },
                { label: "密等", value: classification, setter: (v: string) => setClassification(v as DocumentClassification),
                  options: [["normal","普通"],["confidential","機密"],["secret","秘密"],["top_secret","絕密"]] },
                { label: "類別", value: category, setter: (v: string) => setCategory(v as DocumentCategory),
                  options: [["letter","函"],["decree","令"]] },
              ].map(({ label, value, setter, options }) => (
                <div key={label}>
                  <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>{label}</label>
                  <select value={value} onChange={e => setter(e.target.value)}
                    className="w-full text-slate-300 text-xs outline-none rounded px-2 py-1.5" style={selectStyle}>
                    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>發文機關</label>
              <input value={issuerOrgName} onChange={e => setIssuerOrgName(e.target.value)} placeholder="例：○○大學學生會"
                className="w-full bg-transparent text-slate-300 text-sm outline-none px-2 py-1.5 rounded" style={inputStyle} />
            </div>
          </div>

          {/* 公文內容 */}
          <div className="glass p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>公文內容</h3>
            {[
              { label: "主旨 *", value: subject, setter: setSubject, rows: 2, placeholder: "一句話概述目的，結尾用「請 鑒核」等語。" },
              { label: "說明", value: docDescription, setter: setDocDescription, rows: 4, placeholder: "詳細說明事由、依據..." },
              { label: "辦法", value: actionRequired, setter: setActionRequired, rows: 2, placeholder: "具體請求事項或行動方案..." },
            ].map(({ label, value, setter, rows, placeholder }) => (
              <div key={label}>
                <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>{label}</label>
                <textarea value={value} onChange={e => setter(e.target.value)} rows={rows} placeholder={placeholder}
                  className="w-full bg-transparent text-slate-300 text-sm p-2 rounded outline-none resize-y" style={inputStyle} />
              </div>
            ))}
          </div>

          {/* 受文者 */}
          <div className="glass p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>受文者</h3>
            {recipients.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <span className="px-1.5 py-0.5 rounded" style={{ color: "var(--accent)", background: "var(--accent-dim)" }}>
                  {{ main: "受文者", primary: "正本", copy: "副本" }[r.recipient_type]}
                </span>
                <span className="text-slate-300 flex-1">{r.name}</span>
                {r.email && <span style={{ color: "var(--muted)" }}>{r.email}</span>}
                <button onClick={() => setRecipients(prev => prev.filter(x => x.id !== r.id))}
                  className="text-slate-500 hover:text-red-400">✕</button>
              </div>
            ))}
            <div className="flex gap-2">
              <select value={newRecipient.recipient_type}
                onChange={e => setNewRecipient(p => ({ ...p, recipient_type: e.target.value as RecipientType }))}
                className="text-xs px-2 py-1.5 rounded outline-none" style={{ ...selectStyle, color: "var(--accent)" }}>
                <option value="main">受文者</option><option value="primary">正本</option><option value="copy">副本</option>
              </select>
              <input placeholder="單位/姓名" value={newRecipient.name}
                onChange={e => setNewRecipient(p => ({ ...p, name: e.target.value }))}
                className="flex-1 bg-transparent text-slate-300 text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} />
              <input placeholder="Email（選填）" value={newRecipient.email}
                onChange={e => setNewRecipient(p => ({ ...p, email: e.target.value }))}
                className="flex-1 bg-transparent text-slate-300 text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} />
              <button onClick={addRecipient} className="text-xs px-3 py-1.5 rounded"
                style={{ background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--border-glow)" }}>
                ＋ 新增
              </button>
            </div>
          </div>
        </div>

        {/* 右側 */}
        <div className="space-y-4">
          <div className="glass p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>操作</h3>
            <button onClick={save} disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#0a0e1a" }}>
              {saving ? "儲存中..." : "儲存草稿"}
            </button>
            <p className="text-xs text-center" style={{ color: "var(--muted)" }}>儲存後可在詳情頁設定審核人並送審</p>
          </div>

          <div className="glass p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>承辦人資訊</h3>
            {[
              { label: "姓名", value: handlerName, setter: setHandlerName, ph: "承辦人姓名" },
              { label: "單位", value: handlerUnit, setter: setHandlerUnit, ph: "所屬單位" },
              { label: "電話", value: handlerPhone, setter: setHandlerPhone, ph: "聯絡電話" },
              { label: "Email", value: handlerEmail, setter: setHandlerEmail, ph: "電子郵件" },
            ].map(({ label, value, setter, ph }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs w-10 flex-shrink-0" style={{ color: "var(--muted)" }}>{label}</span>
                <input value={value} onChange={e => setter(e.target.value)} placeholder={ph}
                  className="flex-1 bg-transparent text-slate-300 text-xs px-2 py-1 rounded outline-none" style={inputStyle} />
              </div>
            ))}
          </div>

          <div className="glass p-4">
            <label className="text-xs mb-2 block" style={{ color: "var(--muted)" }}>限辦日期</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full bg-transparent text-slate-300 text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} />
          </div>
        </div>
      </div>
    </div>
  );
}
