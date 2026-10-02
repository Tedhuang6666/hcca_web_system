"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, SlidersHorizontal, UserRound } from "lucide-react";
import { toast } from "sonner";

import { adminApi, apiErrorMessage } from "@/lib/api";
import type { AdminUserDetail } from "@/lib/types";
import { AccountDetailPanel } from "./AccountDetailPanel";

export function AccountDirectoryPanel({
  users,
  loading,
  onRefresh,
}: {
  users: AdminUserDetail[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return users.filter((user) => {
      if (activeOnly && !user.is_active) return false;
      if (!needle) return true;
      return [
        user.display_name,
        user.email,
        user.student_id ?? "",
        ...user.linked_emails,
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [activeOnly, query, users]);

  useEffect(() => {
    setSelectedId((current) => (
      current && filteredUsers.some((user) => user.id === current)
        ? current
        : filteredUsers[0]?.id ?? null
    ));
  }, [filteredUsers]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setSelectedUser(null);
      setDetailLoading(false);
      setDetailError(false);
      return;
    }

    setDetailLoading(true);
    setDetailError(false);
    void adminApi.getUser(selectedId)
      .then((user) => {
        if (!cancelled) setSelectedUser(user);
      })
      .catch(() => {
        if (!cancelled) setDetailError(true);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refresh = async () => {
    await onRefresh();
    if (!selectedId) return;
    try {
      setSelectedUser(await adminApi.getUser(selectedId));
      setDetailError(false);
    } catch (error) {
      setDetailError(true);
      toast.error(apiErrorMessage(error, "載入帳號詳情失敗"));
    }
  };

  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 xl:flex-1 xl:grid-cols-[23rem_1fr]">
      <section className="flex min-h-0 max-h-[38dvh] flex-col overflow-hidden rounded-xl xl:max-h-none" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div className="space-y-3 p-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ border: "1px solid var(--border)" }}>
            <Search size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent text-sm outline-none"
              placeholder="搜尋姓名、學號、Email"
              aria-label="搜尋平台帳號"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {loading ? "載入帳號中…" : "顯示 " + filteredUsers.length + " 個帳號"}
            </p>
            <button
              type="button"
              onClick={() => setActiveOnly((value) => !value)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
              aria-pressed={activeOnly}
              style={{
                color: activeOnly ? "var(--primary)" : "var(--text-muted)",
                background: activeOnly ? "var(--primary-dim)" : "transparent",
                border: "1px solid var(--border)",
              }}
            >
              <SlidersHorizontal size={14} />
              {activeOnly ? "只看啟用" : "全部帳號"}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="space-y-2 p-4">
              <div className="h-16 animate-pulse rounded-lg" style={{ background: "var(--bg-elevated)" }} />
              <div className="h-16 animate-pulse rounded-lg" style={{ background: "var(--bg-elevated)" }} />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              找不到符合條件的帳號。
            </div>
          ) : filteredUsers.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => setSelectedId(user.id)}
              className="flex min-h-[76px] w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
              aria-current={selectedId === user.id ? "true" : undefined}
              style={{
                borderColor: "var(--border)",
                background: selectedId === user.id ? "var(--primary-dim)" : "transparent",
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style={{ background: user.is_active ? "var(--primary-dim)" : "var(--bg-elevated)", color: user.is_active ? "var(--primary)" : "var(--text-muted)" }}>
                {user.display_name.slice(0, 1) || <UserRound size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{user.display_name}</span>
                  {user.is_superuser && <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--warning-dim)", color: "var(--warning)" }}>超管</span>}
                  {!user.is_active && <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--danger-dim)", color: "var(--danger)" }}>停用</span>}
                </div>
                <p className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {user.student_id ?? "無學號"} · {user.email}
                </p>
                <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {user.mfa_enabled ? "已啟用 2FA" : "未啟用 2FA"} · {user.positions.length} 個職位
                </p>
              </div>
              <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-h-[60dvh] min-w-0 flex-col overflow-hidden rounded-xl xl:min-h-0" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        {detailLoading ? (
          <div className="p-6 text-sm" role="status" style={{ color: "var(--text-muted)" }}>載入帳號詳情…</div>
        ) : detailError ? (
          <div className="p-6 text-sm" role="alert" style={{ color: "var(--danger)" }}>無法載入帳號詳情，請重新整理後再試。</div>
        ) : selectedUser ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AccountDetailPanel
              key={selectedUser.id}
              user={selectedUser}
              users={users}
              onChanged={refresh}
            />
          </div>
        ) : (
          <div className="flex min-h-[50dvh] items-center justify-center p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {loading ? "正在載入帳號清單…" : "沒有符合條件的帳號。"}
          </div>
        )}
      </section>
    </div>
  );
}
