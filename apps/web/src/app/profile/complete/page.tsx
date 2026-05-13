"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { usersApi, ApiError } from "@/lib/api";
import type { UserRead } from "@/lib/types";

/** 從學校 Google 信箱中解析學號（g0{student_id}@hchs.hc.edu.tw） */
function parseStudentIdFromEmail(email: string): string {
  const m = email.match(/^g0(\d+)@/i);
  return m ? m[1] : "";
}

export default function CompleteProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserRead | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    usersApi.me().then(u => {
      setUser(u);
      setDisplayName(u.display_name || "");
      setStudentId(u.student_id || parseStudentIdFromEmail(u.email));
    }).catch(() => {
      router.replace("/login");
    }).finally(() => setLoading(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) { toast.error("請填寫顯示名稱"); return; }
    if (!studentId.trim()) { toast.error("請填寫學號"); return; }
    setSaving(true);
    try {
      await usersApi.updateMe({
        display_name: displayName.trim(),
        student_id: studentId.trim(),
      });
      toast.success("個人資料已完成設定");
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      router.replace(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("此學號已被使用，請確認您的學號");
      } else {
        toast.error(e instanceof ApiError ? e.message : "儲存失敗，請稍後再試");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "var(--bg-base)" }}>
      <div className="w-full max-w-md">
        {/* 頁首 */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl font-bold"
            style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
            {user?.display_name?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            完成個人資料
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
            首次登入需填寫以下資料，才能使用系統完整功能
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-5">
          {/* 顯示名稱 */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>
              顯示名稱 <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              className="input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="您的姓名"
              maxLength={100}
              required
              autoFocus
            />
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              通常即您的 Google 帳號名稱，可手動更改
            </p>
          </div>

          {/* 學號 */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>
              學號 <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              className="input"
              value={studentId}
              onChange={e => setStudentId(e.target.value)}
              placeholder="例：410532"
              maxLength={20}
              required
            />
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              已從您的信箱自動帶入，請確認是否正確
            </p>
          </div>

          {/* 信箱（唯讀） */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
              電子郵件（唯讀）
            </label>
            <input
              className="input"
              value={user?.email ?? ""}
              disabled
              style={{ opacity: 0.6, cursor: "not-allowed" }}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary w-full btn-lg">
            {saving ? "儲存中…" : "完成設定，進入系統"}
          </button>
        </form>
      </div>
    </div>
  );
}
