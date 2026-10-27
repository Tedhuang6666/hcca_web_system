"use client";

import { useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import { deadlineFromInput, deadlineInputValue } from "@/lib/shop-deadlines";
import type { CatalogCategoryOut, CloseStatusItem } from "@/lib/types";

export default function ClassDeadlineControls({ label, categories, classId, statuses, onSaved }: {
  label: string;
  categories: CatalogCategoryOut[];
  classId: string | null;
  statuses: Record<string, CloseStatusItem>;
  onSaved: () => Promise<void>;
}) {
  const rows = categories.map((category) => statuses[category.id]);
  const closedCount = rows.filter((row) => row?.is_closed).length;
  const scheduled = rows.find((row) => row?.closes_at && !row.is_closed)?.closes_at ?? null;
  const deadlines = categories.map((category) => category.order_closes_at).filter((value) => !!value);
  const upperBound = deadlines.sort()[0] ?? null;
  const globallyClosed = categories.some((category) => category.order_closed_at)
    || rows.some((row) => row?.is_global && row.is_closed);
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const input = value ?? deadlineInputValue(scheduled);
  const allClosed = closedCount === categories.length;

  async function save(action: "schedule" | "close" | "reopen") {
    if (!classId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      for (const category of categories) {
        const current = statuses[category.id];
        if (action === "reopen") {
          if (current?.is_closed || current?.closes_at) await shopApi.reopenCategory(category.id, classId);
        } else if (!current?.is_closed) {
          await shopApi.closeCategory(category.id, {
            class_id: classId,
            closes_at: action === "schedule" ? deadlineFromInput(input) : null,
          });
        }
      }
      await onSaved();
      setValue(null);
      setMessage(action === "schedule" ? "已設定班級截止時間，到時仍可由班代代訂。"
        : action === "close" ? "本班已截止，班代仍可代訂。" : "已重新開放本班訂購並取消預約截止。");
    } catch (cause) {
      // 前面的分類可能已儲存，重新查詢後讓使用者接續處理。
      await onSaved();
      setError(apiErrorMessage(cause, "班級截止設定未全部完成，請確認目前狀態後重試。"));
    } finally { setBusy(false); }
  }

  return (
    <div className="min-w-0 rounded-md p-3" style={{ border: "1px solid var(--border)" }}>
      <p className="break-words text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {globallyClosed ? "班聯會已全域停止，班代亦無法代訂。"
          : allClosed ? "本班已截止，班代仍可代訂。"
            : closedCount ? `部分截止（${closedCount}/${categories.length} 個分類），班代仍可代訂。`
              : scheduled ? `本班預計於 ${deadlineInputValue(scheduled).replace("T", " ")} 截止（台北時間）。` : "本班開放訂購中。"}
      </p>
      <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); void save("schedule"); }}>
        <label className="text-sm" style={{ color: "var(--text-primary)" }}>
          {label}班級截止時間（台北時間）
          <input type="datetime-local" className="input mt-1 min-h-11 w-full min-w-0 text-base" required
            value={input} max={deadlineInputValue(upperBound)} disabled={busy || globallyClosed || closedCount > 0 || !classId}
            onChange={(event) => setValue(event.target.value)} />
        </label>
        {upperBound && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          不得晚於班聯會設定的 {deadlineInputValue(upperBound).replace("T", " ")}。
        </p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary min-h-11" type="submit"
            disabled={busy || globallyClosed || closedCount > 0 || !classId || !input}>儲存班級截止時間</button>
          <button className="btn btn-ghost min-h-11" type="button" disabled={busy || globallyClosed || !classId}
            onClick={() => void save(allClosed ? "reopen" : "close")}>
            {allClosed ? "重新開放本班" : "立即截止本班"}
          </button>
          {(!allClosed && (scheduled || closedCount > 0)) && <button className="btn btn-ghost min-h-11" type="button"
            disabled={busy || globallyClosed || !classId} onClick={() => void save("reopen")}>
            {closedCount > 0 ? "重新開放本班" : "取消預約截止"}
          </button>}
        </div>
      </form>
      {busy && <p role="status" className="mt-2 text-sm">儲存班級截止設定中…</p>}
      {message && <p role="status" className="mt-2 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
