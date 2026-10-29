"use client";

import { useEffect, useState } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { CatalogCategoryOut, ShopOrderCloseOut } from "@/lib/types";

export default function ClassOrderDeadline({ classId, categories, onSaved }: {
  classId: string; categories: CatalogCategoryOut[]; onSaved: () => void;
}) {
  const [selected, setSelected] = useState("");
  const categoryId = categories.some((category) => category.id === selected) ? selected : categories[0]?.id ?? "";
  const [deadline, setDeadline] = useState("");
  const [current, setCurrent] = useState<ShopOrderCloseOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!categoryId) return;
    let active = true;
    setLoading(true); setLoadError(""); setMessage(""); setError("");
    shopApi.getClassDeadline(categoryId, classId).then((close) => {
      if (!active) return;
      setCurrent(close);
      setDeadline(close?.closes_at ? new Date(close.closes_at).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 16).replace(" ", "T") : "");
    }).catch((cause) => { if (active) setLoadError(apiErrorMessage(cause, "無法載入本班截止設定，請重試。")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [categoryId, classId, retry]);

  async function save(clear = false) {
    if (busy || loading || loadError) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (clear) { await shopApi.reopenCategory(categoryId, classId); setCurrent(null); setDeadline(""); }
      else setCurrent(await shopApi.closeCategory(categoryId, { class_id: classId, closes_at: new Date(`${deadline}:00+08:00`).toISOString() }));
      setMessage(clear ? "已取消本班截止設定；仍須遵守班級繳款與班聯結單規則。" : "已儲存本班截止時間；班代與班聯仍可協助代購。");
      onSaved();
    } catch (cause) { setError(apiErrorMessage(cause, "截止設定更新失敗，請重試。")); }
    finally { setBusy(false); }
  }
  if (!categoryId) return null;
  return <details className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card-bg)" }}>
    <summary className="min-h-11 cursor-pointer content-center font-semibold">本班截止時間</summary>
    <p className="my-3 text-sm" style={{ color: "var(--text-secondary)" }}>截止後，同學與家人停止自行訂購，班代與班聯仍可代購。班聯結單後班代停止代購，班聯追加一律獨立補收款。</p>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <legend className="sr-only">本班截止設定</legend>
        <label className="grid gap-1 text-sm">截止主題<select className="input min-h-11 text-base" value={categoryId} onChange={(event) => setSelected(event.target.value)}>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm">本班截止時間（臺北時間）<input className="input min-h-11 min-w-0 text-base" type="datetime-local" required value={deadline} disabled={loading || Boolean(loadError)} onChange={(event) => setDeadline(event.target.value)} /></label>
        <button className="btn btn-secondary min-h-11" type="submit" disabled={loading || Boolean(loadError) || !deadline}>{busy ? "更新中…" : "儲存本班截止時間"}</button>
        {current && <button className="btn btn-ghost min-h-11" type="button" disabled={loading || Boolean(loadError)} onClick={() => void save(true)}>取消本班截止</button>}
      </fieldset>
    </form>
    {loading && <p role="status">載入本班截止設定中…</p>}
    {loadError && <div role="alert"><p>{loadError}</p><button className="btn btn-ghost min-h-11" type="button" onClick={() => setRetry((value) => value + 1)}>重試截止設定</button></div>}
    {message && <p role="status" className="mt-3">{message}</p>}
    {error && <p role="alert" className="mt-3">{error}</p>}
  </details>;
}
