"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import Toggle from "@/components/ui/Toggle";
import {
  lowDataPreferenceLabel,
  readLowDataMode,
  writeLowDataMode,
} from "@/lib/data-saver";

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
          <h1 className="text-xl font-semibold">省流模式</h1>
        </div>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          <RotateCcw size={15} aria-hidden={true} />
          依瀏覽器設定
        </button>
      </header>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">減少背景流量</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              目前狀態：{statusLabel}
            </p>
          </div>
          <Toggle checked={enabled} onChange={toggle} ariaLabel="減少背景流量" />
        </div>
      </section>
    </div>
  );
}
