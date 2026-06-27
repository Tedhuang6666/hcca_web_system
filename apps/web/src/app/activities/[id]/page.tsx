"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { activitiesApi, receivablesApi } from "@/lib/api";
import type { Activity, ActivityWorkspaceOut, ReceivableOut } from "@/lib/types";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";

const STATUS_LABEL: Record<string, string> = {
  done: "完成",
  open: "待處理",
  warning: "需注意",
};

export default function ActivityWorkspacePage() {
  const params = useParams<{ id: string }>();
  const activityId = params.id;
  const [activity, setActivity] = useState<Activity | null>(null);
  const [workspace, setWorkspace] = useState<ActivityWorkspaceOut | null>(null);
  const [receivables, setReceivables] = useState<ReceivableOut[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [activityData, workspaceData, receivableRows] = await Promise.all([
        activitiesApi.get(activityId),
        activitiesApi.workspace(activityId),
        receivablesApi.list({ activity_id: activityId, limit: 100 }),
      ]);
      setActivity(activityData);
      setWorkspace(workspaceData);
      setReceivables(receivableRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入活動工作區失敗");
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const finance = useMemo(() => {
    const total = receivables.reduce((sum, item) => sum + item.amount, 0);
    const paid = receivables.reduce((sum, item) => sum + item.paid_amount, 0);
    return { total, paid, unpaid: Math.max(total - paid, 0) };
  }, [receivables]);

  const acceptSuggestion = async (suggestionId: string) => {
    try {
      await activitiesApi.acceptSuggestion(activityId, suggestionId);
      toast.success("已建立活動關聯");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "接受推薦失敗");
    }
  };

  if (loading && !workspace) {
    return <main className="p-6">載入活動工作區中...</main>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>活動工作區</p>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {activity?.name ?? "活動"}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {activity?.description || "集中查看這個活動牽涉的公告、會議、訂單、收款與任務。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activity && (
            <GovernanceLinkPanel
              entityType="activity"
              entityId={activity.id}
              title={activity.name}
              href={`/activities/${activity.id}`}
              compact
            />
          )}
          <Link className="btn btn-ghost" href={`/finance/receivables?activity_id=${activityId}`}>收款對帳</Link>
          <Link className="btn btn-primary" href={`/publications/new?activity_id=${activityId}`}>建立發布</Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="關聯資料" value={workspace?.sections.reduce((n, s) => n + s.count, 0) ?? 0} />
        <Metric label="待處理" value={workspace?.pending_items.length ?? 0} />
        <Metric label="已收金額" value={`NT$${finance.paid.toLocaleString()}`} />
        <Metric label="未收金額" value={`NT$${finance.unpaid.toLocaleString()}`} />
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">活動檢查清單</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {(workspace?.checklist ?? []).map((item) => (
            <div key={item.key} className="rounded border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-3">
                <strong>{item.title}</strong>
                <span className="text-xs" style={{ color: item.status === "done" ? "var(--success)" : "var(--warning)" }}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </div>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{item.action}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {(workspace?.sections ?? []).map((section) => (
            <section key={section.key}>
              <h2 className="mb-2 text-base font-semibold">{section.title} · {section.count}</h2>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="block rounded border p-3 text-sm"
                    style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                  >
                    <span className="font-medium">{item.title}</span>
                    {item.note && <span className="ml-2" style={{ color: "var(--text-muted)" }}>{item.note}</span>}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="space-y-5">
          <section>
            <h2 className="mb-2 text-base font-semibold">系統推薦關聯</h2>
            <div className="space-y-2">
              {(workspace?.suggestions ?? []).length === 0 && (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>目前沒有新的推薦。</p>
              )}
              {(workspace?.suggestions ?? []).map((item) => (
                <div key={item.suggestion_id} className="rounded border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong className="text-sm">{item.title}</strong>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {item.target_type} · {item.score} 分 · {item.reasons.join("、")}
                      </p>
                    </div>
                    <button className="btn btn-primary text-xs" onClick={() => void acceptSuggestion(item.suggestion_id)}>
                      掛上
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold">收款摘要</h2>
            <div className="space-y-2">
              {receivables.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
                  <div className="flex justify-between gap-3">
                    <span>{item.title}</span>
                    <strong>NT${item.amount.toLocaleString()}</strong>
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    已收 NT${item.paid_amount.toLocaleString()} · {item.status}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}
