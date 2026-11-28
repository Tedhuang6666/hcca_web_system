"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { AccountDetailPanel } from "@/components/admin/AccountDetailPanel";
import { adminApi, ApiError } from "@/lib/api";
import type { AdminUserDetail, SchoolClassListItem } from "@/lib/types";

export default function LinkedAccountSection({
  userId,
  users,
  classes,
  canManageClasses,
  onChanged,
}: {
  userId: string;
  users: AdminUserDetail[];
  classes: SchoolClassListItem[];
  canManageClasses: boolean;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setUser(await adminApi.getUser(userId));
    } catch (error) {
      setFailed(true);
      toast.error(error instanceof ApiError ? error.message : "載入連結帳號失敗");
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <details
      className="min-w-0 rounded-md border border-border!"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-fg-secondary!">
        登入帳號、任期與安全
      </summary>
      {!open ? null : failed ? (
        <div className="flex items-center gap-3 px-4 pb-4 text-sm text-fg-muted!">
          載入失敗
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <RefreshCcw size={14} /> 重試
          </button>
        </div>
      ) : !user ? (
        <p className="px-4 pb-4 text-sm text-fg-muted!">載入帳號資料...</p>
      ) : (
        <AccountDetailPanel
          embedded
          user={user}
          users={users}
          classes={classes}
          canManageClasses={canManageClasses}
          onChanged={async () => {
            await load();
            await onChanged();
          }}
        />
      )}
    </details>
  );
}
