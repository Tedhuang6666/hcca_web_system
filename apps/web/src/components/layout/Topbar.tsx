"use client";

export default function Topbar() {
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b flex-shrink-0"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>

      {/* Breadcrumb / Page Title area */}
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
        <span>校園自治整合平台</span>
        <span>/</span>
        <span className="text-slate-300">公文系統</span>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {/* Status indicator */}
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
          style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse-slow" />
          系統正常
        </div>

        {/* Notification bell */}
        <button className="relative w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
          style={{ border: "1px solid var(--border)" }}>
          🔔
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full"
            style={{ background: "var(--accent)", boxShadow: "0 0 6px var(--accent)" }} />
        </button>

        {/* User avatar */}
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold cursor-pointer"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-glow)", color: "var(--accent)" }}>
          U
        </div>
      </div>
    </header>
  );
}
