"use client";

import { useEffect, useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ActivityOut } from "@/lib/types";
import { deadlineFromInput, deadlineInputValue } from "@/lib/shop-deadlines";

function ActivityDeadline({ activity, onSaved }: { activity: ActivityOut; onSaved: () => void }) {
  const [value, setValue] = useState(deadlineInputValue(activity.order_closes_at ?? null));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <form className="grid min-w-0 grid-cols-2 items-end gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={async (event) => {
      event.preventDefault();
      setSaving(true); setError(""); setMessage("");
      try {
        const updated = await shopApi.updateActivityDeadline(activity.id, deadlineFromInput(value));
        setValue(deadlineInputValue(updated.order_closes_at ?? null));
        setMessage(updated.order_closes_at ? "已儲存活動結單時間" : "已取消活動統一期限");
        onSaved();
      } catch (cause) {
        setError(apiErrorMessage(cause, "結單時間儲存失敗，請再試一次。"));
      } finally { setSaving(false); }
    }}>
      <label className="col-span-2 min-w-0 text-sm sm:col-span-1" style={{ color: "var(--text-primary)" }}>
        <span className="mb-1 block font-medium">{activity.name}停止訂購時間</span>
        <input type="datetime-local" value={value} disabled={saving}
          onChange={(event) => { setValue(event.target.value); setMessage(""); }}
          className="input min-h-11 w-full min-w-0" />
      </label>
      <button type="submit" disabled={saving} className="btn btn-secondary min-h-11">
        {saving ? "儲存中…" : "儲存結單時間"}
      </button>
      {value && <button type="button" disabled={saving} className="btn btn-ghost min-h-11"
        onClick={() => { setValue(""); setMessage("請按儲存結單時間，套用取消設定。"); }}>清除時間</button>}
      {message && <p role="status" className="col-span-full text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>}
      {error && <p role="alert" className="col-span-full text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    </form>
  );
}

export default function ActivityDeadlines({ onSaved }: { onSaved: () => void }) {
  const [activities, setActivities] = useState<ActivityOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void shopApi.listActivities().then((rows) => { if (active) setActivities(rows); })
      .catch((cause) => { if (active) setError(apiErrorMessage(cause, "無法載入活動，請重新載入。")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  return (
    <details className="card p-4">
      <summary className="min-h-11 cursor-pointer content-center font-semibold"
        style={{ color: "var(--text-primary)" }}>活動結單時間</summary>
      <p className="my-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        時間以台北時間顯示。同一活動下所有主題與系列共用結單時間；單品另設截止時間時優先適用，可針對該商品延長。留空表示不設活動統一期限。
      </p>
      {loading ? <p role="status">載入活動中…</p> : error ? <div role="alert">
        <p>{error}</p><button type="button" className="btn btn-ghost min-h-11"
          onClick={() => setAttempt((current) => current + 1)}>重新載入活動</button>
      </div> : activities.length ? activities.map((activity) => (
        <ActivityDeadline key={activity.id} activity={activity} onSaved={onSaved} />
      )) : <p className="py-3 text-sm" style={{ color: "var(--text-muted)" }}>
        目前沒有可設定的活動。請先建立活動，再於「編輯主題」選擇所屬活動。
      </p>}
    </details>
  );
}
