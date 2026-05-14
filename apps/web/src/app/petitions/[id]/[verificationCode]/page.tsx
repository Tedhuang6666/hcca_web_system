"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { PetitionStatusBadge } from "@/components/ui/StatusBadge";
import { ApiError, petitionsApi } from "@/lib/api";
import type { PetitionCaseOut } from "@/lib/types";

function fmt(iso: string | null) {
  if (!iso) return "未設定";
  return new Date(iso).toLocaleString("zh-TW");
}

export default function PetitionSharePage() {
  const params = useParams<{ id: string; verificationCode: string }>();
  const [item, setItem] = useState<PetitionCaseOut | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItem(await petitionsApi.directLookup(params.id, params.verificationCode));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "查詢失敗");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [params.id, params.verificationCode]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="max-w-4xl mx-auto card p-5">載入中...</div>;
  if (!item) {
    return (
      <div className="max-w-2xl mx-auto card p-5 space-y-3">
        <p style={{ color: "var(--text-muted)" }}>案號或驗證碼錯誤，無法查看此案件。</p>
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
        <PetitionStatusBadge status={item.status} />
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
