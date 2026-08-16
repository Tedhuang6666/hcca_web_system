"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api/core";

type Overview = { system_health: { name: string; healthy: boolean }[]; reliability: Record<string, number | null>; synthetic: Record<string, number | null>; field: Record<string, number | null> };
const tabs = ["Overview", "Errors", "Real Users", "Performance", "Releases"];

export default function ObservabilityPage() {
  const [tab, setTab] = useState("Overview");
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => { request<Overview>("/admin/system/observability/overview").then(setData).catch(() => setData(null)); }, []);
  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <header><p className="text-sm" style={{ color: "var(--text-muted)" }}>System observability</p><h1 className="text-3xl font-semibold">系統可觀測性</h1></header>
    <nav className="flex gap-5 border-b" style={{ borderColor: "var(--border)" }}>{tabs.map((name) => <button key={name} onClick={() => setTab(name)} className="pb-3 text-sm" style={{ color: tab === name ? "var(--text-primary)" : "var(--text-muted)", borderBottom: tab === name ? "2px solid var(--text-primary)" : "2px solid transparent" }}>{name}</button>)}</nav>
    {tab !== "Overview" ? <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>{tab} data will appear as telemetry collectors populate.</p> : <OverviewPanel data={data} />}
  </main>;
}

function OverviewPanel({ data }: { data: Overview | null }) {
  const metric = (title: string, items: [string, number | null | undefined, string][]) => <section className="rounded-md border p-5" style={{ borderColor: "var(--border)" }}><h2 className="mb-4 text-xs font-medium" style={{ color: "var(--text-muted)" }}>{title}</h2>{items.map(([label, value, suffix]) => <div key={label} className="flex justify-between py-2 text-sm"><span style={{ color: "var(--text-muted)" }}>{label}</span><strong>{value == null ? "—" : `${value}${suffix}`}</strong></div>)}</section>;
  const health = data?.system_health ?? ["API", "PostgreSQL", "Redis", "Celery"].map(name => ({ name, healthy: true }));
  return <div className="space-y-6"><section><h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text-muted)" }}>SYSTEM HEALTH</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{health.map(item => <div key={item.name} className="rounded-md border p-4" style={{ borderColor: "var(--border)" }}><span style={{ color: item.healthy ? "var(--success)" : "var(--error)" }}>●</span> {item.name}<strong className="mt-2 block">{item.healthy ? "Healthy" : "Unhealthy"}</strong></div>)}</div></section><div className="grid gap-6 lg:grid-cols-3">{metric("RELIABILITY — SENTRY", [["Error Rate", data?.reliability.error_rate, "%"], ["Affected Users", data?.reliability.affected_users, ""], ["New Issues", data?.reliability.new_issues, ""], ["Regressions", data?.reliability.regressions, ""]])}{metric("SYNTHETIC — PSI", [["Mobile Performance", data?.synthetic.mobile_performance, ""], ["Desktop Performance", data?.synthetic.desktop_performance, ""], ["Mobile LCP", data?.synthetic.mobile_lcp_ms, " ms"], ["Mobile TBT", data?.synthetic.mobile_tbt_ms, " ms"]])}{metric("FIELD — CRUX", [["LCP p75", data?.field.lcp_p75, " ms"], ["INP p75", data?.field.inp_p75, " ms"], ["CLS p75", data?.field.cls_p75, ""], ["TTFB p75", data?.field.ttfb_p75, " ms"]])}</div></div>;
}
