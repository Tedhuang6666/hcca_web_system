"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, petitionsApi } from "@/lib/api";
import type { PetitionCaseOut } from "@/lib/types";
import { PetitionStatusBadge } from "@/components/ui/StatusBadge";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";

function fmt(iso: string | null) {
  if (!iso) return "未設定";
  return new Date(iso).toLocaleString("zh-TW");
}

export default function PetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<PetitionCaseOut | null>(null);
  const [supplement, setSupplement] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItem(await petitionsApi.get(params.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "載入失敗；若您是訪客，請從案號查詢進入");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const submitSupplement = async () => {
    if (!item) return;
    try {
      const updated = await petitionsApi.supplement(item.id, {
        content: supplement,
        verification_code: verificationCode || null,
      });
      if (file) await petitionsApi.uploadAttachment(item.id, file, { verification_code: verificationCode || undefined });
      setItem(updated);
      setSupplement("");
      setFile(null);
      toast.success("補件已送出");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "補件失敗");
    }
  };

  if (loading) return <div className="max-w-4xl mx-auto card p-5">載入中...</div>;
  if (!item) {
    return (
      <div className="max-w-2xl mx-auto card p-5 space-y-3">
        <p style={{ color: "var(--text-muted)" }}>無法直接查看此案件。</p>
        <Link className="btn btn-primary" href="/petitions">回案號查詢</Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>案號 {item.case_number}</p>
          <h1 className="text-xl font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{item.title}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{item.current_org_name} · {item.type_name}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <GovernanceLinkPanel
            entityType="petition"
            entityId={item.id}
            title={`${item.case_number} ${item.title}`}
            href={`/petitions/${item.id}`}
            compact
          />
          <PetitionStatusBadge status={item.status} />
        </div>
      </div>

      <section className="card p-5 space-y-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <div><p className="text-xs text-muted">目前階段</p><p className="font-medium">{item.status_label}</p></div>
          <div><p className="text-xs text-muted">負責機關</p><p className="font-medium">{item.current_org_name}</p></div>
          <div><p className="text-xs text-muted">承辦人</p><p className="font-medium">{item.assigned_to_name || "尚未分案"}</p></div>
          <div><p className="text-xs text-muted">最後更新</p><p className="font-medium">{fmt(item.updated_at)}</p></div>
        </div>
        <p className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}>
          {item.status_public_message} 下一步：{item.next_action}
        </p>
      </section>

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-5">
        <section className="card p-5 space-y-4">
          <h2 className="font-semibold">陳情內容</h2>
          <p className="whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--text-primary)" }}>{item.content}</p>
          {item.public_reply && (
            <div className="rounded-lg p-4" style={{ background: "var(--success-dim)", border: "1px solid var(--success-border)" }}>
              <p className="font-medium mb-2" style={{ color: "var(--success)" }}>承辦回覆</p>
              <p className="whitespace-pre-wrap text-sm">{item.public_reply}</p>
            </div>
          )}
          {item.rejection_reason && (
            <div className="rounded-lg p-4" style={{ background: "var(--danger-dim)", border: "1px solid var(--danger-border)" }}>
              <p className="font-medium mb-2" style={{ color: "var(--danger)" }}>不受理原因</p>
              <p className="whitespace-pre-wrap text-sm">{item.rejection_reason}</p>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="card p-5 space-y-3">
            <h2 className="font-semibold">附件</h2>
            {item.attachments.length === 0 ? <p className="text-sm text-muted">尚無附件</p> : item.attachments.map((att) => (
              <a key={att.id} className="block rounded-lg p-3 text-sm" style={{ border: "1px solid var(--border)", textDecoration: "none" }} href={petitionsApi.attachmentDownloadUrl(item.id, att.id)} target="_blank">
                {att.display_name || att.filename}
              </a>
            ))}
          </section>

          {item.can_supplement && (
            <section className="card p-5 space-y-3">
              <h2 className="font-semibold">補充資料</h2>
              {item.supplement_request && <p className="text-sm" style={{ color: "var(--danger)" }}>{item.supplement_request}</p>}
              <textarea className="input w-full min-h-28" value={supplement} onChange={(e) => setSupplement(e.target.value)} placeholder="請補充承辦機關要求的資料" />
              <input className="input w-full" placeholder="訪客驗證碼（登入本人可留空）" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))} maxLength={5} />
              <input className="input w-full" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button className="btn btn-primary w-full" disabled={!supplement.trim()} onClick={submitSupplement}>送出補件</button>
            </section>
          )}
        </aside>
      </div>

      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">處理時間軸</h2>
        <div className="space-y-3">
          {item.events.map((event) => (
            <div key={event.id} className="pl-4 py-1" style={{ borderLeft: "2px solid var(--border)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{event.title}</p>
              {event.content && <p className="text-sm whitespace-pre-wrap mt-1" style={{ color: "var(--text-muted)" }}>{event.content}</p>}
              <p className="text-xs mt-1" style={{ color: "var(--text-disabled)" }}>{fmt(event.created_at)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
