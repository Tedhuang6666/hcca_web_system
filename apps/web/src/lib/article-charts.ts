export type ArticleChartType = "pie" | "bar";

export type ArticleChartDatum = {
  label: string;
  value: number;
};

export type ArticleChartSpec = {
  type: ArticleChartType;
  title: string;
  description?: string;
  unit?: string;
  data: ArticleChartDatum[];
};

export function isArticleChartSpec(value: unknown): value is ArticleChartSpec {
  if (!value || typeof value !== "object") return false;
  const chart = value as Partial<ArticleChartSpec>;
  if (chart.type !== "pie" && chart.type !== "bar") return false;
  if (typeof chart.title !== "string" || !chart.title.trim() || chart.title.length > 120) return false;
  if (chart.description !== undefined
    && (typeof chart.description !== "string" || chart.description.length > 320)) return false;
  if (chart.unit !== undefined && (typeof chart.unit !== "string" || chart.unit.length > 24)) return false;
  if (!Array.isArray(chart.data) || chart.data.length < 1 || chart.data.length > 10) return false;

  return chart.data.every((item) => {
    if (!item || typeof item !== "object") return false;
    const datum = item as Partial<ArticleChartDatum>;
    return typeof datum.label === "string"
      && Boolean(datum.label.trim())
      && datum.label.length <= 80
      && typeof datum.value === "number"
      && Number.isFinite(datum.value)
      && datum.value >= 0
      && datum.value <= 1_000_000_000_000;
  });
}
