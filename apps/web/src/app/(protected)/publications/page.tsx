"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { publicationsApi } from "@/lib/api";
import type { PublicationCampaignOut } from "@/lib/types";

export default function PublicationsPage() {
  const [items, setItems] = useState<PublicationCampaignOut[]>([]);

  const reload = async () => {
    try {
      setItems(await publicationsApi.list({ limit: 100 }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入發布任務失敗");
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const send = async (id: string) => {
    try {
      await publicationsApi.send(id);
      toast.success("已送出發布任務");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "送出發布失敗");
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>發布中心</p>
          <h1 className="text-2xl font-semibold">多渠道發布任務</h1>
        </div>
        <Link className="btn btn-primary" href="/publications/new">新增發布</Link>
      </header>

      <section className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded border p-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  {item.channels.join("、") || "尚未選擇渠道"} · {item.status}
                </p>
              </div>
              {item.status !== "sent" && (
                <button className="btn btn-primary" onClick={() => void send(item.id)}>送出</button>
              )}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
