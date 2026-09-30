import type { PetitionMonthlyStatsOut } from "@/lib/types";

function formatHours(value: number | null) {
  if (value === null) return "尚無結案資料";
  if (value < 1) return `${Math.round(value * 60)} 分鐘`;
  return `${value.toFixed(1)} 小時`;
}

export default function PetitionMonthlyChart({
  stats,
}: {
  stats: PetitionMonthlyStatsOut;
}) {
  const maxCount = Math.max(1, ...stats.by_type.map((item) => item.count));
  const headingId = `petition-monthly-chart-${stats.month.replace("-", "")}`;

  return (
    <section
      className="my-7 rounded-2xl border p-5 sm:p-6"
      style={{
        borderColor: "var(--border, var(--public-border))",
        background: "var(--bg-surface, var(--public-surface))",
        color: "var(--text-primary, var(--public-text))",
      }}
      aria-labelledby={headingId}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="m-0 text-lg font-semibold">
          {stats.month} 陳情統計
        </h3>
        <span className="text-xs" style={{ color: "var(--text-muted, var(--public-muted))" }}>
          受理類型依受理日；結案數依結案日
        </span>
      </header>

      <dl className="mt-4 grid gap-3 border-y py-4 sm:grid-cols-3" style={{ borderColor: "var(--border, var(--public-border))" }}>
        <div>
          <dt className="text-xs" style={{ color: "var(--text-muted, var(--public-muted))" }}>本月受理</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{stats.received_total} 案</dd>
        </div>
        <div>
          <dt className="text-xs" style={{ color: "var(--text-muted, var(--public-muted))" }}>本月結案</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{stats.completed_total} 案</dd>
        </div>
        <div>
          <dt className="text-xs" style={{ color: "var(--text-muted, var(--public-muted))" }}>平均結案時間</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{formatHours(stats.average_completion_hours)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <h4 className="mb-3 text-sm font-semibold">陳情類型</h4>
        {stats.by_type.length === 0 ? (
          <p className="m-0 text-sm" style={{ color: "var(--text-muted, var(--public-muted))" }}>
            本月尚無受理案件。
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {stats.by_type.map((item) => (
              <li key={item.type_name}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words">{item.type_name}</span>
                  <strong className="shrink-0 tabular-nums">{item.count} 案</strong>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full"
                  style={{ background: "var(--bg-hover, var(--public-soft))" }}
                  role="img"
                  aria-label={`${item.type_name}：${item.count} 案`}
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max((item.count / maxCount) * 100, 2)}%`,
                      background: "var(--primary, var(--public-accent-text))",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
