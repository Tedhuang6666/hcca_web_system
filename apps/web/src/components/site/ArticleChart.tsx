"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import type { ArticleChartSpec } from "@/lib/article-charts";

function chartColor(index: number) {
  return "var(--article-chart-color-" + ((index % 6) + 1) + ", var(--public-accent, #1e6467))";
}

function formatValue(value: number, unit?: string) {
  const formatted = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value);
  return unit ? formatted + " " + unit : formatted;
}

function pieSlicePath(startDegrees: number, sweepDegrees: number) {
  if (sweepDegrees >= 359.99) return "M 100 100 m -88 0 a 88 88 0 1 0 176 0 a 88 88 0 1 0 -176 0";

  const toPoint = (degrees: number) => {
    const radians = (degrees - 90) * Math.PI / 180;
    return {
      x: 100 + 88 * Math.cos(radians),
      y: 100 + 88 * Math.sin(radians),
    };
  };
  const start = toPoint(startDegrees);
  const end = toPoint(startDegrees + sweepDegrees);
  const largeArc = sweepDegrees > 180 ? 1 : 0;
  return "M 100 100 L " + start.x + " " + start.y
    + " A 88 88 0 " + largeArc + " 1 " + end.x + " " + end.y + " Z";
}

export default function ArticleChart({ chart }: { chart: ArticleChartSpec }) {
  const rootRef = useRef<HTMLElement>(null);
  const [entered, setEntered] = useState(false);
  const headingId = "article-chart-" + useId().replaceAll(":", "");
  const total = chart.data.reduce((sum, item) => sum + item.value, 0);
  const maxValue = Math.max(0, ...chart.data.map((item) => item.value));
  const barTickStep = maxValue <= 5 ? 1 : Math.ceil(maxValue / 4);
  const barAxisMax = Math.ceil(maxValue / barTickStep) * barTickStep;
  const barTicks = Array.from(
    { length: barAxisMax / barTickStep + 1 },
    (_, index) => barTickStep * index,
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!("IntersectionObserver" in window)) {
      setEntered(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setEntered(true);
        observer.disconnect();
      }
    }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  let angle = 0;
  const slices = chart.data.map((item, index) => {
    const sweep = total > 0 ? item.value / total * 360 : 0;
    const path = pieSlicePath(angle, sweep);
    angle += sweep;
    return { item, index, path };
  });

  return (
    <figure
      ref={rootRef}
      className="article-chart"
      data-entered={entered ? "true" : undefined}
      aria-labelledby={headingId}
    >
      <header className="article-chart__heading">
        <h3 id={headingId}>{chart.title}</h3>
        {chart.description && <p>{chart.description}</p>}
      </header>

      {total <= 0 ? (
        <p className="article-chart__empty">尚無可呈現的數據，請補上大於 0 的項目數值。</p>
      ) : chart.type === "pie" ? (
        <div className="article-chart__pie-layout">
          <svg className="article-chart__pie" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
            {slices.map(({ item, index, path }) => (
              item.value > 0 && (
                <path
                  key={item.label}
                  d={path}
                  fill={chartColor(index)}
                  stroke="var(--public-surface, var(--bg-surface, #ffffff))"
                  strokeWidth="2"
                />
              )
            ))}
          </svg>
          <ul className="article-chart__legend" aria-label="圖表資料">
            {chart.data.map((item, index) => {
              const share = total > 0 ? item.value / total * 100 : 0;
              return (
                <li key={item.label}>
                  <span className="article-chart__legend-key" style={{ backgroundColor: chartColor(index) }} aria-hidden="true" />
                  <span className="article-chart__legend-label">{item.label}</span>
                  <strong>{formatValue(item.value, chart.unit)}</strong>
                  <span className="article-chart__legend-share">{share.toFixed(1)}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div
          className="article-chart__bar-chart"
          role="img"
          aria-label={chart.title + "；" + chart.data.map((item) => item.label + " " + formatValue(item.value, chart.unit)).join("；")}
        >
          <div className="article-chart__bar-y-axis" aria-hidden="true">
            <div className="article-chart__bar-y-scale">
              {barTicks.map((value) => (
                <span
                  key={value}
                  style={{ top: (1 - value / barAxisMax) * 100 + "%" }}
                >
                  {new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value)}
                </span>
              ))}
            </div>
          </div>
          <div className="article-chart__bar-plot">
            <div className="article-chart__bar-gridlines" aria-hidden="true">
              {barTicks.map((value) => (
                <span
                  key={value}
                  style={{ top: (1 - value / barAxisMax) * 100 + "%" }}
                />
              ))}
            </div>
            <ol
              className="article-chart__bar-columns"
              style={{ "--article-chart-column-count": chart.data.length } as CSSProperties}
              aria-hidden="true"
            >
              {chart.data.map((item, index) => {
                const height = item.value / barAxisMax * 100;
                const style = {
                  "--article-chart-bar-height": height + "%",
                  "--article-chart-bar-delay": index * 70 + "ms",
                } as CSSProperties;
                return (
                  <li key={item.label}>
                    <div className="article-chart__bar-area">
                      <strong className="article-chart__bar-value" style={style}>
                        {formatValue(item.value, chart.unit)}
                      </strong>
                      <span
                        className="article-chart__bar-column"
                        style={{ ...style, backgroundColor: chartColor(index) }}
                      />
                    </div>
                    <span className="article-chart__bar-category">{item.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </figure>
  );
}
