"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { publicationsApi } from "@/lib/api";

const CHANNELS = [
  ["announcement", "站內公告"],
  ["email", "Email"],
  ["line", "LINE"],
  ["discord", "Discord"],
  ["web_push", "Web Push"],
] as const;

export default function NewPublicationPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<string[]>(["announcement"]);
  const activityId = search.get("activity_id");

  const toggle = (channel: string) => {
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  };

  const create = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("請輸入標題與內容");
      return;
    }
    try {
      const created = await publicationsApi.create({
        title: title.trim(),
        body: body.trim(),
        activity_id: activityId,
        channels,
        audience_type: "all",
      });
      toast.success("已建立發布任務");
      router.push(`/publications#${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立發布任務失敗");
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>發布中心</p>
        <h1 className="text-2xl font-semibold">新增多渠道發布</h1>
      </header>

      <section className="space-y-4">
        <input
          className="input w-full"
          placeholder="發布標題"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="input min-h-64 w-full"
          placeholder="發布內容"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={channels.includes(key) ? "btn btn-primary" : "btn btn-ghost"}
              onClick={() => toggle(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => void create()}>建立發布任務</button>
      </section>
    </main>
  );
}
