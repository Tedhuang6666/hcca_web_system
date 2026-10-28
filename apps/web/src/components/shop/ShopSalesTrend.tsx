"use client";

import { useId, useRef, useState } from "react";
import type { ShopSalesPeriod } from "@/lib/types";

type Measure =
  "order_count" | "item_count" | "total_amount" | "cumulative_amount";
const measures: [Measure, string][] = [
  ["order_count", "每日訂單"],
  ["item_count", "每日件數"],
  ["total_amount", "每日金額"],
  ["cumulative_amount", "累積金額"],
];
const number = (value: number) => value.toLocaleString("zh-TW");
const fullDate = (value: string) =>
  new Date(`${value}T00:00:00+08:00`).toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

export default function ShopSalesTrend({
  current,
}: {
  current: ShopSalesPeriod;
}) {
  const [measure, setMeasure] = useState<Measure>("order_count");
  const [active, setActive] = useState<number | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(8);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const tooltipId = useId();
  const values = current.daily.map((row) => row[measure]);
  const maximum = Math.max(1, ...values);
  const x = (index: number) =>
    72 + (index / Math.max(1, values.length - 1)) * 890;
  const y = (value: number) => 235 - (value / maximum) * 170;
  const points = (numbers: number[]) =>
    numbers.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const showIndex = (index: number, reveal = false) => {
    setActive(index);
    const container = scrollContainer.current;
    if (!container?.clientWidth) return;
    const width =
      container.querySelector("svg")?.getBoundingClientRect().width ?? 0;
    const point = (x(index) / 1000) * width;
    if (reveal)
      container.scrollLeft = Math.max(
        0,
        Math.min(
          container.scrollWidth - container.clientWidth,
          point - container.clientWidth / 2,
        ),
      );
    setTooltipLeft(
      Math.max(
        container.scrollLeft + 8,
        Math.min(
          point - 130,
          container.scrollLeft + container.clientWidth - 268,
        ),
      ),
    );
  };
  const select = (clientX: number, element: SVGSVGElement) => {
    const rect = element.getBoundingClientRect();
    if (rect.width)
      showIndex(
        Math.max(
          0,
          Math.min(
            values.length - 1,
            Math.round(
              ((((clientX - rect.left) / rect.width) * 1000 - 72) / 890) *
                Math.max(1, values.length - 1),
            ),
          ),
        ),
      );
  };
  const ticks = [
    ...new Set(
      Array.from({ length: Math.min(values.length, 6) }, (_, index) =>
        Math.round(
          (index / Math.max(1, Math.min(values.length, 6) - 1)) *
            (values.length - 1),
        ),
      ),
    ),
  ];
  const day = active === null ? null : current.daily[active];
  const label = measures.find(([key]) => key === measure)?.[1] ?? "每日訂單";
  return (
    <section className="sales-trend" aria-label="每日訂購趨勢">
      <h3>每日訂購趨勢</h3>
      <div className="sales-measures">
        {measures.map(([key, title]) => (
          <button
            type="button"
            className="btn btn-ghost"
            key={key}
            aria-pressed={key === measure}
            onClick={() => setMeasure(key)}
          >
            {title}
          </button>
        ))}
      </div>
      <p className="sales-muted">
        橫軸為本期實際日期。滑鼠移到圖上、點選或使用左右方向鍵，可查看完整日期與數值；手機可左右滑動圖表。
      </p>
      <div
        className="sales-chart-scroll"
        ref={scrollContainer}
        onScroll={() => {
          if (active !== null) showIndex(active);
        }}
      >
        <div className="sales-chart-canvas">
          <svg
            viewBox="0 0 1000 285"
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, values.length - 1)}
            aria-valuenow={active ?? 0}
            aria-valuetext={
              day
                ? `${day.key}，${label} ${number(day[measure])}`
                : "移動游標或按方向鍵選擇日期"
            }
            aria-describedby={day ? tooltipId : undefined}
            onPointerMove={(event) =>
              select(event.clientX, event.currentTarget)
            }
            onPointerLeave={() => {
              if (!pinned.current) setActive(null);
            }}
            onClick={(event) => {
              pinned.current = true;
              select(event.clientX, event.currentTarget);
            }}
            onFocus={() => {
              pinned.current = true;
              showIndex(active ?? 0, true);
            }}
            onBlur={() => {
              pinned.current = false;
              setActive(null);
            }}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
                  event.key,
                )
              )
                event.preventDefault();
              if (event.key === "ArrowLeft")
                showIndex(Math.max(0, (active ?? 0) - 1), true);
              if (event.key === "ArrowRight")
                showIndex(Math.min(values.length - 1, (active ?? 0) + 1), true);
              if (event.key === "Home") showIndex(0, true);
              if (event.key === "End") showIndex(values.length - 1, true);
              if (event.key === "Escape") {
                pinned.current = false;
                setActive(null);
              }
            }}
          >
            {[0, 0.5, 1].map((ratio) => (
              <g key={ratio}>
                <line
                  x1="72"
                  x2="962"
                  y1={y(maximum * ratio)}
                  y2={y(maximum * ratio)}
                  stroke="var(--border)"
                />
                <text x="62" y={y(maximum * ratio) + 5} textAnchor="end">
                  {number(Math.round(maximum * ratio))}
                </text>
              </g>
            ))}
            {ticks.map((index) => (
              <text
                key={index}
                x={x(index)}
                y="267"
                textAnchor={
                  index === 0
                    ? "start"
                    : index === values.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {current.daily[index]?.key.replaceAll("-", "/")}
              </text>
            ))}
            <polyline
              points={points(values)}
              fill="none"
              stroke="var(--primary-text)"
              strokeWidth="3"
            />
            {values.length <= 60 &&
              values.map((value, index) => (
                <circle
                  key={current.daily[index].key}
                  cx={x(index)}
                  cy={y(value)}
                  r="3"
                  fill="var(--primary-text)"
                >
                  <title>
                    {current.daily[index].key}：{number(value)}
                  </title>
                </circle>
              ))}
            {active !== null && day && (
              <g>
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1="55"
                  y2="235"
                  stroke="var(--text-secondary)"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={x(active)}
                  cy={y(day[measure])}
                  r="6"
                  fill="var(--primary-text)"
                  stroke="var(--card-bg)"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>
          {day && (
            <div
              className="sales-chart-tooltip"
              role="tooltip"
              id={tooltipId}
              style={{
                left: tooltipLeft,
              }}
            >
              <strong>
                <time dateTime={day.key}>{fullDate(day.key)}</time>
              </strong>
              <p>
                本期：{number(day.order_count)} 筆 · {number(day.item_count)} 件
                · NT${number(day.total_amount)}
              </p>
              <p>
                {label}：{measure.includes("amount") ? "NT$" : ""}
                {number(day[measure])}
              </p>
            </div>
          )}
        </div>
      </div>
      <p className="sales-chart-legend">
        <span>所選區間的有效訂購資料</span>
      </p>
      <details>
        <summary>每日明細</summary>
        <div className="sales-table-scroll">
          <table>
            <caption className="sr-only">每日訂單、件數與金額</caption>
            <thead>
              <tr>
                {["日期", "訂單", "人數", "件數", "金額", "累積金額"].map(
                  (title) => (
                    <th scope="col" key={title}>
                      {title}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {current.daily.map((row, index) => (
                <tr key={row.key}>
                  <th scope="row">{row.key}</th>
                  <td>{number(row.order_count)}</td>
                  <td>{number(row.buyer_count)}</td>
                  <td>{number(row.item_count)}</td>
                  <td>NT${number(row.total_amount)}</td>
                  <td>NT${number(row.cumulative_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
