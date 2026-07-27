"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { PetitionStatusBadge } from "@/components/ui/StatusBadge";
import { ApiError, petitionsApi } from "@/lib/api";
import type { PetitionCaseOut } from "@/lib/types";

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("zh-TW") : "未設定";
}

export default function PetitionSharePage() {
  const [item, setItem] = useState<PetitionCaseOut | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const shareToken = window.location.hash.slice(1);
    if (!shareToken) {
      setLoading(false);
      return;
    }
    try {
      setItem(await petitionsApi.lookupShare(shareToken));
      // Token 已以 POST body 用過；立即移除，避免停留於瀏覽器歷史。
      window.history.replaceState(null, "", "/petitions/share");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "查詢失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="max-w-4xl mx-auto card p-5">載入中...</div>;
  if (!item) {
    return (
      <div className="max-w-2xl mx-auto card p-5 space-y-3">
        <p style={{ color: "var(--text-muted)" }}>分享連結無效或已被移除。</p>
        <Link className="btn btn-primary" href="/petitions">回案件查詢</Link>
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
    </div>
  );
}
