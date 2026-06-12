"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { activitiesApi, adminApi, orgsApi } from "@/lib/api";
import type { Activity, ActivityConvener, AdminUserDetail, OrgRead } from "@/lib/types";
import { today } from "@/lib/dateUtils";

const STATUS_LABEL: Record<Activity["status"], string> = {
  draft: "草稿",
  active: "進行中",
  ended: "已結束",
  archived: "已封存",
};

export default function AdminActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [users, setUsers] = useState<AdminUserDetail[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [conveners, setConveners] = useState<ActivityConvener[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", org_id: "", description: "", starts_at: "", ends_at: "" });
  const [appoint, setAppoint] = useState({ user_id: "", start_date: today(), end_date: "" });

  const selected = useMemo(
    () => activities.find((activity) => activity.id === selectedId) ?? activities[0],
    [activities, selectedId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [activityRows, orgRows, userRows] = await Promise.all([
        activitiesApi.list(),
        orgsApi.list({ active_only: true }),
        adminApi.listUsers({ active_only: true, limit: 200 }),
      ]);
      setActivities(activityRows);
      setOrgs(orgRows);
      setUsers(userRows);
      if (!selectedId && activityRows[0]) setSelectedId(activityRows[0].id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入活動資料失敗");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selected?.id) {
      setConveners([]);
      return;
    }
    activitiesApi.listConveners(selected.id)
      .then(setConveners)
      .catch((error) => toast.error(error instanceof Error ? error.message : "載入總召失敗"));
  }, [selected?.id]);

  const createActivity = async () => {
    if (!form.name.trim()) return toast.error("請輸入活動名稱");
    try {
      const created = await activitiesApi.create({
        name: form.name.trim(),
        org_id: form.org_id || null,
        description: form.description.trim() || null,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        status: "active",
      });
      toast.success("已建立活動");
      setForm({ name: "", org_id: "", description: "", starts_at: "", ends_at: "" });
      setSelectedId(created.id);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立活動失敗");
    }
  };

  const archiveSelected = async () => {
    if (!selected) return;
    try {
      await activitiesApi.archive(selected.id);
      toast.success("已封存活動");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "封存活動失敗");
    }
  };

  const appointConvener = async () => {
    if (!selected || !appoint.user_id) return toast.error("請選擇總召");
    try {
      await activitiesApi.appointConvener(selected.id, {
        user_id: appoint.user_id,
        start_date: appoint.start_date || today(),
        end_date: appoint.end_date || null,
      });
      toast.success("已任命總召");
      setAppoint({ user_id: "", start_date: today(), end_date: "" });
      setConveners(await activitiesApi.listConveners(selected.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "任命總召失敗");
    }
  };

  const removeConvener = async (id: string) => {
    if (!selected) return;
    try {
      await activitiesApi.removeConvener(id);
      toast.success("已卸任總召");
      setConveners(await activitiesApi.listConveners(selected.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "卸任總召失敗");
    }
  };

  return (
    <main className="mx-auto flex max-w-7xl gap-6 p-6">
      <section className="w-80 shrink-0">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>活動管理</h1>
          <button className="rounded border px-3 py-1.5 text-sm" onClick={() => void reload()} disabled={loading}>重新整理</button>
        </div>
        <div className="space-y-2">
          {activities.map((activity) => (
            <button
              key={activity.id}
              onClick={() => setSelectedId(activity.id)}
              className="block w-full rounded border p-3 text-left text-sm"
              style={{
                borderColor: activity.id === selected?.id ? "var(--brand)" : "var(--border)",
                background: activity.id === selected?.id ? "var(--bg-elevated)" : "transparent",
              }}
            >
              <span className="block font-medium" style={{ color: "var(--text-primary)" }}>{activity.name}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{STATUS_LABEL[activity.status]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-base font-semibold" style={{ color: "var(--text-primary)" }}>建立活動</h2>
          <div className="space-y-3">
            <input className="w-full rounded border px-3 py-2" placeholder="活動名稱" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="w-full rounded border px-3 py-2" value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })}>
              <option value="">不隸屬組織</option>
              {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            <textarea className="w-full rounded border px-3 py-2" placeholder="說明" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border px-3 py-2" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              <input className="rounded border px-3 py-2" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </div>
            <button className="rounded px-4 py-2 text-sm text-white" style={{ background: "var(--brand)" }} onClick={() => void createActivity()}>建立</button>
          </div>
        </div>

        <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-base font-semibold" style={{ color: "var(--text-primary)" }}>{selected?.name ?? "選擇活動"}</h2>
          {selected && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{selected.description || "無說明"}</p>
              <div className="flex flex-wrap gap-2">
                <Link className="rounded border px-3 py-1.5 text-sm" href={`/activities/${selected.id}`}>開啟工作區</Link>
                <Link className="rounded border px-3 py-1.5 text-sm" href={`/shop/admin?activity_id=${selected.id}`}>商品 / 票券</Link>
                <Link className="rounded border px-3 py-1.5 text-sm" href={`/shop?activity_id=${selected.id}`}>購票頁</Link>
                <button className="rounded border px-3 py-1.5 text-sm" onClick={() => void archiveSelected()} disabled={selected.status === "archived"}>封存活動</button>
              </div>
              <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <h3 className="mb-2 text-sm font-medium">活動總召</h3>
                <div className="mb-3 grid grid-cols-1 gap-2 xl:grid-cols-[1fr_120px_120px_auto]">
                  <select className="rounded border px-3 py-2" value={appoint.user_id} onChange={(e) => setAppoint({ ...appoint, user_id: e.target.value })}>
                    <option value="">選擇使用者</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.display_name} · {user.email}</option>)}
                  </select>
                  <input className="rounded border px-3 py-2" type="date" value={appoint.start_date} onChange={(e) => setAppoint({ ...appoint, start_date: e.target.value })} />
                  <input className="rounded border px-3 py-2" type="date" value={appoint.end_date} onChange={(e) => setAppoint({ ...appoint, end_date: e.target.value })} />
                  <button className="rounded px-3 py-2 text-sm text-white" style={{ background: "var(--brand)" }} onClick={() => void appointConvener()}>任命</button>
                </div>
                <div className="space-y-2">
                  {conveners.map((convener) => (
                    <div key={convener.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <span>{convener.user_name || convener.user_email} · {convener.start_date} 至 {convener.end_date || "未定"}</span>
                      <button className="rounded border px-2 py-1 text-xs" onClick={() => void removeConvener(convener.id)}>卸任</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
