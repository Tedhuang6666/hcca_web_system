import Link from "next/link";

const stats = [
  { label: "草稿中", value: 3, icon: "📝", color: "#475569" },
  { label: "待審核", value: 7, icon: "⏳", color: "#fb923c" },
  { label: "本月核准", value: 24, icon: "✅", color: "#22d3ee" },
  { label: "退件", value: 2, icon: "↩️", color: "#f87171" },
];

const recentDocs = [
  { id: "1", serial: "DOC-2026-000012", title: "2026 春季聯誼活動申請", status: "pending", date: "2026-04-09", step: 2, total: 3 },
  { id: "2", serial: "DOC-2026-000011", title: "社團經費核銷申請", status: "approved", date: "2026-04-08", step: 3, total: 3 },
  { id: "3", serial: "DOC-2026-000010", title: "場地借用申請書", status: "draft", date: "2026-04-07", step: 0, total: 2 },
  { id: "4", serial: "DOC-2026-000009", title: "幹部名冊更新申請", status: "rejected", date: "2026-04-06", step: 1, total: 2 },
];

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  draft:    { label: "草稿",  color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  pending:  { label: "待審核", color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  approved: { label: "已核准", color: "#22d3ee", bg: "rgba(34,211,238,0.1)" },
  rejected: { label: "退件",  color: "#f87171", bg: "rgba(248,113,113,0.1)" },
};

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">公文儀表板</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>歡迎回來，所有公文狀態一覽</p>
        </div>
        <Link href="/documents/new"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:opacity-90"
          style={{ background: "var(--accent)", color: "#0a0e1a" }}>
          ＋ 新增公文
        </Link>
      </div>

      {/* 統計卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon, color }) => (
          <div key={label} className="glass glass-hover p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>{label}</p>
                <p className="text-3xl font-bold" style={{ color }}>{value}</p>
              </div>
              <span className="text-2xl">{icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 近期公文列表 */}
      <div className="glass">
        <div className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold text-slate-200">近期公文</h2>
          <Link href="/documents" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
            查看全部 →
          </Link>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {recentDocs.map((doc) => {
            const cfg = statusConfig[doc.status];
            return (
              <Link key={doc.id} href={`/documents/${doc.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors group">
                {/* 字號 */}
                <span className="text-xs font-mono w-36 flex-shrink-0" style={{ color: "var(--accent)" }}>
                  {doc.serial}
                </span>
                {/* 標題 */}
                <span className="flex-1 text-sm text-slate-300 group-hover:text-slate-100 truncate">
                  {doc.title}
                </span>
                {/* 審核進度（待審核才顯示） */}
                {doc.status === "pending" && (
                  <div className="flex items-center gap-1.5 mr-2">
                    {Array.from({ length: doc.total }).map((_, i) => (
                      <div key={i} className="w-5 h-1.5 rounded-full transition-all"
                        style={{
                          background: i < doc.step ? "var(--accent)" : "rgba(56,189,248,0.2)",
                        }} />
                    ))}
                    <span className="text-xs ml-1" style={{ color: "var(--muted)" }}>
                      {doc.step}/{doc.total}
                    </span>
                  </div>
                )}
                {/* 狀態徽章 */}
                <span className="text-xs px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
                  {cfg.label}
                </span>
                {/* 日期 */}
                <span className="text-xs w-20 text-right flex-shrink-0" style={{ color: "var(--muted)" }}>
                  {doc.date}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
