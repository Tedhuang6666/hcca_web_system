"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, SlidersHorizontal, UserRound } from "lucide-react";
import { toast } from "sonner";

import { adminApi, apiErrorMessage } from "@/lib/api";
import type { AdminUserDetail, ClassRosterSummary, SchoolClassListItem } from "@/lib/types";
import { AccountDetailPanel } from "./AccountDetailPanel";

function rosterClassLabel(entry: ClassRosterSummary) {
  return entry.class_label ?? (entry.academic_year + " 學年度 " + entry.class_code + " 班");
}

function classOptionLabel(item: SchoolClassListItem) {
  return item.academic_year + " 學年度 " + (item.label ?? (item.class_code + " 班"));
}

function userClassSummary(user: AdminUserDetail) {
  const activeRows = user.class_roster.filter((entry) => entry.is_active);
  const rows = activeRows.length > 0 ? activeRows : user.class_roster.slice(0, 1);
  if (rows.length === 0) return "未設定班級座號";
  return rows.map((entry) => {
    const historyLabel = entry.is_active ? "" : "歷史 · ";
    return historyLabel + rosterClassLabel(entry) + " · 座號 " + entry.seat_number;
  }).join("；");
}

function accountSearchKey(keyword: string, activeOnly: boolean, classId: string) {
  return keyword.toLocaleLowerCase() + "::" + activeOnly + "::" + classId;
}

export function AccountDirectoryPanel({
  users,
  loading,
  onRefresh,
  classes,
  canManageClasses,
}: {
  users: AdminUserDetail[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  classes: SchoolClassListItem[];
  canManageClasses: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [classFilter, setClassFilter] = useState("");
  const [searchData, setSearchData] = useState<{
    key: string;
    users: AdminUserDetail[];
  } | null>(null);
  const [searchErrorKey, setSearchErrorKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const normalizedQuery = query.trim();
  const shouldSearchRemote = Boolean(normalizedQuery || classFilter);
  const searchKey = shouldSearchRemote
    ? accountSearchKey(normalizedQuery, activeOnly, classFilter)
    : "";
  const searchResolved = !shouldSearchRemote
    || searchData?.key === searchKey
    || searchErrorKey === searchKey;

  useEffect(() => {
    if (!shouldSearchRemote) return;
    const key = accountSearchKey(normalizedQuery, activeOnly, classFilter);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void adminApi.listUsers({
        keyword: normalizedQuery || undefined,
        class_id: classFilter || undefined,
        active_only: activeOnly,
        limit: 200,
      })
        .then((rows) => {
          if (!cancelled) {
            setSearchData({ key, users: rows });
            setSearchErrorKey(null);
          }
        })
        .catch(() => {
          if (!cancelled) setSearchErrorKey(key);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeOnly, classFilter, normalizedQuery, shouldSearchRemote]);

  const filteredUsers = useMemo(() => {
    const needle = normalizedQuery.toLocaleLowerCase();
    const sourceUsers = shouldSearchRemote
      ? (searchData?.key === searchKey ? searchData.users : [])
      : users;
    return sourceUsers.filter((user) => {
      if (activeOnly && !user.is_active) return false;
      if (classFilter && !user.class_roster.some((entry) => entry.class_id === classFilter)) return false;
      if (!needle) return true;
      return [
        user.display_name,
        user.email,
        user.student_id ?? "",
        ...user.class_roster.flatMap((entry) => [
          rosterClassLabel(entry),
          entry.class_code,
          String(entry.seat_number),
        ]),
        ...user.linked_emails,
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [activeOnly, classFilter, normalizedQuery, searchData, searchKey, shouldSearchRemote, users]);

  useEffect(() => {
    if (!searchResolved) return;
    setSelectedId((current) => (
      current && filteredUsers.some((user) => user.id === current)
        ? current
        : filteredUsers[0]?.id ?? null
    ));
  }, [filteredUsers, searchResolved]);

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
    if (shouldSearchRemote) {
      const key = accountSearchKey(normalizedQuery, activeOnly, classFilter);
      try {
        const rows = await adminApi.listUsers({
          keyword: normalizedQuery || undefined,
          class_id: classFilter || undefined,
          active_only: activeOnly,
          limit: 200,
        });
        setSearchData({ key, users: rows });
        setSearchErrorKey(null);
      } catch (error) {
        setSearchErrorKey(key);
        toast.error(apiErrorMessage(error, "搜尋帳號失敗"));
      }
    }
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
              placeholder="搜尋姓名、學號、Email、班級或座號"
              aria-label="搜尋平台帳號"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {loading && !normalizedQuery
                ? "載入帳號中…"
                : shouldSearchRemote && !searchResolved
                  ? "搜尋中…"
                  : "顯示 " + filteredUsers.length + " 個帳號"}
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:items-center">
              <select
                value={classFilter}
                onChange={(event) => setClassFilter(event.target.value)}
                className="min-h-11 min-w-0 rounded-lg px-2.5 text-xs sm:w-44"
                aria-label="依班級篩選帳號"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                <option value="">全部班級</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{classOptionLabel(item)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setActiveOnly((value) => !value)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
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
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loading && !shouldSearchRemote ? (
            <div className="space-y-2 p-4">
              <div className="h-16 animate-pulse rounded-lg" style={{ background: "var(--bg-elevated)" }} />
              <div className="h-16 animate-pulse rounded-lg" style={{ background: "var(--bg-elevated)" }} />
            </div>
          ) : shouldSearchRemote && !searchResolved ? (
            <div className="p-8 text-center text-sm" role="status" style={{ color: "var(--text-muted)" }}>
              正在搜尋帳號…
            </div>
          ) : searchErrorKey === searchKey ? (
            <div className="p-8 text-center text-sm" role="alert" style={{ color: "var(--danger)" }}>
              搜尋帳號失敗，請調整關鍵字或重新整理後再試。
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
              className="flex min-h-[88px] w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
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
                <p className="mt-1 truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                  {userClassSummary(user)}
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

      <section className="flex min-w-0 flex-col overflow-visible rounded-xl xl:min-h-0 xl:overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        {detailLoading ? (
          <div className="p-6 text-sm" role="status" style={{ color: "var(--text-muted)" }}>載入帳號詳情…</div>
        ) : detailError ? (
          <div className="p-6 text-sm" role="alert" style={{ color: "var(--danger)" }}>無法載入帳號詳情，請重新整理後再試。</div>
        ) : selectedUser ? (
          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <AccountDetailPanel
              key={selectedUser.id}
              user={selectedUser}
              users={users}
              classes={classes}
              canManageClasses={canManageClasses}
              onChanged={refresh}
            />
          </div>
        ) : (
          <div className="flex min-h-[35dvh] items-center justify-center p-8 text-center text-sm xl:min-h-0 xl:flex-1" style={{ color: "var(--text-muted)" }}>
            {loading ? "正在載入帳號清單…" : "沒有符合條件的帳號。"}
          </div>
        )}
      </section>
    </div>
  );
}
