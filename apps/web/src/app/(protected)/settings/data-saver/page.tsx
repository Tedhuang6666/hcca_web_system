"use client";

import { useEffect, useState } from "react";
import { Check, Gauge, Radio, RotateCcw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  lowDataPreferenceLabel,
  readLowDataMode,
  writeLowDataMode,
} from "@/lib/data-saver";

const SAVINGS = [
  {
    title: "政策版本檢查",
    body: "進站時不顯示檢查中彈窗，無待同意政策會快取；省流時改由伺服器要求再補查。",
  },
  {
    title: "通知與待辦",
    body: "一般導覽區停用即時 WebSocket，背景輪詢從 1 分鐘降低到 5 分鐘。",
  },
  {
    title: "系統狀態與公告",
    body: "模組維護狀態與緊急公告使用短期快取，減少每次進站的背景請求。",
  },
];

export default function DataSaverSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [statusLabel, setStatusLabel] = useState("未啟用");

  const sync = () => {
    setEnabled(readLowDataMode());
    setStatusLabel(lowDataPreferenceLabel());
  };

  useEffect(() => {
    sync();
    window.addEventListener("hcca:low-data-mode-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("hcca:low-data-mode-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = () => {
    const next = !enabled;
    writeLowDataMode(next);
    setEnabled(next);
    setStatusLabel(next ? "已手動啟用" : lowDataPreferenceLabel());
    toast.success(next ? "已啟用省流模式" : "已關閉省流模式");
  };

  const reset = () => {
    writeLowDataMode(false);
    setEnabled(false);
    setStatusLabel(lowDataPreferenceLabel());
    toast.success("已改回依瀏覽器設定判斷");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            DATA SAVER
          </p>
          <h1 className="mt-1 text-xl font-semibold">省流模式</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            降低非必要背景連線，適合行動網路、熱點或流量有限的使用者。
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          <RotateCcw size={15} aria-hidden={true} />
          依瀏覽器設定
        </button>
      </header>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-md"
            style={{ background: "var(--bg-muted)", color: "var(--primary)" }}
          >
            <WifiOff size={18} aria-hidden={true} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">減少背景流量</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              目前狀態：{statusLabel}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={toggle}
            className="inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors"
            style={{ background: enabled ? "var(--primary)" : "var(--border-strong)" }}
          >
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full bg-white transition-transform"
              style={{ transform: enabled ? "translateX(24px)" : "translateX(4px)" }}
            >
              {enabled && <Check size={10} aria-hidden={true} style={{ color: "var(--primary)" }} />}
            </span>
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {SAVINGS.map((item, index) => {
          const Icon = index === 0 ? Gauge : Radio;
          return (
            <article
              key={item.title}
              className="rounded-lg border p-4"
              style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            >
              <Icon size={16} aria-hidden={true} style={{ color: "var(--primary)" }} />
              <h2 className="mt-3 text-sm font-semibold">{item.title}</h2>
              <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                {item.body}
              </p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
