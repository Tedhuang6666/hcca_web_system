"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { publicationsApi } from "@/lib/api";
import type { PublicationCampaignOut } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { SectionSkeleton } from "@/components/ui/Skeleton";

const CHANNEL_LABELS: Record<string, string> = {
  announcement: "站內公告",
  email: "Email",
  line: "LINE",
  discord: "Discord",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  scheduled: "已排程",
  sent: "已送出",
  canceled: "已取消",
};

function channelList(channels: string[]) {
  return channels.map((channel) => CHANNEL_LABELS[channel] ?? channel).join("、");
}

export default function PublicationsPage() {
  const confirm = useConfirm();
  const [items, setItems] = useState<PublicationCampaignOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const reload = async () => {
    try {
      setItems(await publicationsApi.list({ limit: 100 }));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "載入發布任務失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const send = async (item: PublicationCampaignOut) => {
    if (!(await confirm({
      title: `送出「${item.title}」？`,
      description: item.channels.length > 0
        ? `將發布到：${channelList(item.channels)}。送出後無法收回。`
        : "尚未選擇渠道。",
      confirmLabel: "送出",
      danger: true,
    }))) return;
    setSendingId(item.id);
    try {
      await publicationsApi.send(item.id);
      toast.success("已送出發布任務");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "送出發布失敗");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">發布中心</h1>
        <Link className="btn btn-primary" href="/publications/new">新增發布</Link>
      </header>

      {loading ? (
        <SectionSkeleton lines={4} />
      ) : loadError ? (
        <div role="alert" className="card space-y-3 p-5">
          <p className="text-sm" style={{ color: "var(--danger)" }}>{loadError}</p>
          <button type="button" className="btn btn-ghost" onClick={() => { setLoading(true); void reload(); }}>
            重新載入
          </button>
        </div>
      ) : items.length === 0 ? (
        <SmartEmptyState reason="new" subject="發布任務" createHref="/publications/new" />
      ) : (
        <section className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{item.title}</h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                    {item.channels.length > 0 ? channelList(item.channels) : "尚未選擇渠道"}
                    {" · "}
                    {STATUS_LABELS[item.status] ?? item.status}
                  </p>
                </div>
                {item.status !== "sent" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={sendingId !== null}
                    onClick={() => void send(item)}>
                    {sendingId === item.id ? "送出中…" : "送出"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
