"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mattersApi } from "@/lib/api";
import type { MatterOut, MatterResourceType, TimelineEventOut } from "@/lib/types";

const RESOURCE_LABEL: Record<string, string> = {
  google_meet: "Google Meet",
  google_drive: "Google Drive",
  discord_text: "Discord 文字",
  discord_voice: "Discord 語音",
  external_url: "外部連結",
  file: "檔案",
  other: "其他",
};

export default function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [matter, setMatter] = useState<MatterOut | null>(null);
  const [timeline, setTimeline] = useState<TimelineEventOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceType, setResourceType] = useState<MatterResourceType>("external_url");

  useEffect(() => {
    params.then((value) => setId(value.id));
  }, [params]);

  async function load(matterId: string) {
    setLoading(true);
    try {
      const [detail, events] = await Promise.all([
        mattersApi.get(matterId),
        mattersApi.timeline(matterId),
      ]);
      setMatter(detail);
      setTimeline(events);
    } catch (error) {
      toast.error("無法載入事項");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) void load(id);
  }, [id]);

  async function addResource(event: FormEvent) {
    event.preventDefault();
    if (!id || !resourceTitle.trim() || !resourceUrl.trim()) return;
    setAdding(true);
    try {
      await mattersApi.createResource(id, {
        title: resourceTitle.trim(),
        url: resourceUrl.trim(),
        resource_type: resourceType,
      });
      setResourceTitle("");
      setResourceUrl("");
      toast.success("資源已加入事項");
      await load(id);
    } catch (error) {
      toast.error("新增資源失敗");
      console.error(error);
    } finally {
      setAdding(false);
    }
  }

  async function deleteResource(resourceId: string) {
    if (!id) return;
    try {
      await mattersApi.deleteResource(id, resourceId);
      toast.success("資源已移除");
      await load(id);
    } catch (error) {
      toast.error("移除資源失敗");
      console.error(error);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-6xl items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={16} className="animate-spin" />
        載入事項中
      </div>
    );
  }

  if (!matter) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg p-6 text-sm" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
        找不到此事項。
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="space-y-2">
        <Link href="/matters" className="text-xs" style={{ color: "var(--accent)" }}>
          返回整合工作台
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {matter.matter_type} / {matter.status}
            </p>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {matter.title}
            </h1>
          </div>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            進度 {matter.progress_percent}%
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Summary label="關聯" value={matter.links.length} />
        <Summary label="資源" value={matter.resources.length} />
        <Summary label="時間軸" value={timeline.length} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Panel title="關聯資料">
            {matter.links.length === 0 ? (
              <Empty text="尚未建立跨模組關聯。" />
            ) : (
              <div className="space-y-2">
                {matter.links.map((link) => (
                  <a
                    key={link.id}
                    href={link.href ?? "#"}
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{link.title}</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {link.relation} / {link.target_type}
                      </span>
                    </span>
                    <Link2 size={14} />
                  </a>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="時間軸">
            {timeline.length === 0 ? (
              <Empty text="尚無事件紀錄。" />
            ) : (
              <div className="space-y-3">
                {timeline.map((event) => (
                  <div key={event.id} className="border-l-2 pl-3" style={{ borderColor: "var(--border)" }}>
                    <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {event.title}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {new Date(event.created_at).toLocaleString("zh-TW")} / {event.event_type}
                    </div>
                    {event.body && (
                      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                        {event.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="外部資源">
            <form onSubmit={addResource} className="mb-3 space-y-2">
              <select
                value={resourceType}
                onChange={(event) => setResourceType(event.target.value as MatterResourceType)}
                className="input w-full"
              >
                {Object.entries(RESOURCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input
                value={resourceTitle}
                onChange={(event) => setResourceTitle(event.target.value)}
                className="input w-full"
                placeholder="資源名稱"
              />
              <input
                value={resourceUrl}
                onChange={(event) => setResourceUrl(event.target.value)}
                className="input w-full"
                placeholder="https://..."
              />
              <button type="submit" className="btn btn-primary w-full" disabled={adding}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                加入資源
              </button>
            </form>

            {matter.resources.length === 0 ? (
              <Empty text="尚未加入 Google Meet、Discord、Drive 或外部連結。" />
            ) : (
              <div className="space-y-2">
                {matter.resources.map((resource) => (
                  <div
                    key={resource.id}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-2"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    <a href={resource.url} target="_blank" rel="noreferrer" className="min-w-0 text-sm">
                      <span className="block truncate font-medium" style={{ color: "var(--text-primary)" }}>
                        {resource.title}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {RESOURCE_LABEL[resource.resource_type] ?? resource.resource_type}
                      </span>
                    </a>
                    <div className="flex gap-1">
                      <a href={resource.url} target="_blank" rel="noreferrer" className="topbar-icon-btn" aria-label="開啟資源">
                        <ExternalLink size={14} />
                      </a>
                      <button type="button" className="topbar-icon-btn" onClick={() => void deleteResource(resource.id)} aria-label="移除資源">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <h2 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm" style={{ color: "var(--text-muted)" }}>{text}</p>;
}
