"use client";

import { useEffect, useState } from "react";

import PetitionMonthlyChart from "@/components/site/PetitionMonthlyChart";
import { apiErrorMessage } from "@/lib/api";
import { petitionsApi } from "@/lib/api/petitions";
import type { PetitionMonthlyStatsOut } from "@/lib/types";

function currentMonth() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month
    ? `${year}-${month}`
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function PetitionMonthlyStatsPanel() {
  const [month, setMonth] = useState(currentMonth);
  const [stats, setStats] = useState<PetitionMonthlyStatsOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void petitionsApi.monthlyStats(month)
      .then((result) => {
        if (active) setStats(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setStats(null);
          setError(apiErrorMessage(reason, "讀取陳情月統計失敗"));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month]);

  return (
    <section className="space-y-3" aria-labelledby="petition-monthly-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="petition-monthly-heading" className="text-lg font-semibold">陳情月統計</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            受理數按案件受理日計算；結案件數與平均時間按結案日計算。
          </p>
        </div>
        <label className="space-y-1.5 text-sm font-medium">
          <span>統計月份</span>
          <input
            className="input min-h-11 w-full sm:w-52"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            aria-label="選擇陳情統計月份"
          />
        </label>
      </div>

      {loading ? (
        <div className="h-52 animate-pulse rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }} role="status" aria-label="正在載入陳情月統計" />
      ) : error ? (
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} role="alert">
          {error}。請確認帳號具有陳情統計權限，或稍後重新整理。
        </div>
      ) : stats ? (
        <PetitionMonthlyChart stats={stats} />
      ) : null}
    </section>
  );
}
