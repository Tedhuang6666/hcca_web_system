import ArticleChart from "@/components/site/ArticleChart";
import type { ArticleChartSpec } from "@/lib/article-charts";
import type { PetitionMonthlyStatsOut } from "@/lib/types";

function formatHours(value: number | null) {
  if (value === null) return "尚無結案資料";
  if (value < 1) return Math.round(value * 60) + " 分鐘";
  return value.toFixed(1) + " 小時";
}

export default function PetitionMonthlyChart({
  stats,
}: {
  stats: PetitionMonthlyStatsOut;
}) {
  const headingId = "petition-monthly-chart-" + stats.month.replace("-", "");
  const chart: ArticleChartSpec = {
    type: "pie",
    title: "陳情案件類型分布",
    description: "依案件受理日計算本月收件類型。",
    unit: "案",
    data: stats.by_type.map((item) => ({ label: item.type_name, value: item.count })),
  };

  return (
    <section className="my-7 space-y-4" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="m-0 text-lg font-semibold">
          {stats.month} 陳情統計
        </h3>
        <span className="text-xs" style={{ color: "var(--public-muted, var(--text-muted))" }}>
          受理數按受理日；結案數與平均時間按結案日
        </span>
      </header>

      <dl className="grid gap-3 border-y py-4 sm:grid-cols-3" style={{ borderColor: "var(--public-border, var(--border))" }}>
        <div>
          <dt className="text-xs" style={{ color: "var(--public-muted, var(--text-muted))" }}>本月受理</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{stats.received_total} 案</dd>
        </div>
        <div>
          <dt className="text-xs" style={{ color: "var(--public-muted, var(--text-muted))" }}>本月結案</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{stats.completed_total} 案</dd>
        </div>
        <div>
          <dt className="text-xs" style={{ color: "var(--public-muted, var(--text-muted))" }}>平均結案時間</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{formatHours(stats.average_completion_hours)}</dd>
        </div>
      </dl>

      {stats.by_type.length > 0 ? (
        <ArticleChart chart={chart} />
      ) : (
        <p className="m-0 text-sm" style={{ color: "var(--public-muted, var(--text-muted))" }}>
          本月尚無陳情案件類型資料。
        </p>
      )}
    </section>
  );
}
