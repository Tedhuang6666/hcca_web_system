"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ShopOfficeOut } from "@/lib/types";

function OfficeRow({ office, onSaved }: { office: ShopOfficeOut; onSaved: (office: ShopOfficeOut) => void }) {
  const [name, setName] = useState(office.name);
  const [sortOrder, setSortOrder] = useState(String(office.sort_order));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const order = Number(sortOrder);
  const validOrder = sortOrder.trim() !== "" && Number.isInteger(order) && order >= 0 && order <= 2147483647;
  const save = async (active?: boolean) => {
    if (busy || (active === undefined && (!name.trim() || !validOrder))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const updated = await shopApi.updateOffice(office.id, active === undefined
        ? { name: name.trim(), sort_order: order } : { is_active: active });
      onSaved(updated);
      if (active === undefined) { setName(updated.name); setSortOrder(String(updated.sort_order)); }
      setMessage(active === undefined ? "名稱與顯示順序已儲存。" : active ? "處室已啟用。" : "處室已停用。");
    } catch (cause) { setError(apiErrorMessage(cause, "處室未更新，請重試。")); }
    finally { setBusy(false); }
  };
  return <li className="py-4" style={{ borderBottom: "1px solid var(--border)" }}>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="flex-1 min-w-0 basis-52 text-sm" style={{ color: "var(--text-primary)" }}>
        處室名稱
        <input className="input mt-1 w-full min-h-11" aria-label={`${office.name}的名稱`} value={name} maxLength={100} required disabled={busy}
          onChange={(event) => { setName(event.target.value); setMessage(""); }} />
      </label>
      <label className="w-28 text-sm" style={{ color: "var(--text-primary)" }}>
        顯示順序
        <input type="number" className="input mt-1 w-full min-h-11" aria-label={`${office.name}的顯示順序`}
          aria-describedby="office-sort-help" min={0} max={2147483647} step={1} required disabled={busy} value={sortOrder}
          onChange={(event) => { setSortOrder(event.target.value); setMessage(""); }} />
      </label>
      <span className="pb-3 text-sm" style={{ color: "var(--text-secondary)" }}>{office.is_active ? "啟用中" : "已停用"}</span>
      <button type="submit" className="btn btn-secondary min-h-11" disabled={busy || !name.trim() || !validOrder || (name.trim() === office.name && order === office.sort_order)}>儲存設定</button>
      <button type="button" className="btn btn-ghost min-h-11" disabled={busy} aria-label={`${office.is_active ? "停用" : "啟用"}${office.name}`}
        onClick={() => void save(!office.is_active)}>{office.is_active ? "停用" : "啟用"}</button>
    </form>
    {error && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    {message && <p role="status" className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>}
  </li>;
}

export default function ShopOfficesPanel() {
  const [offices, setOffices] = useState<ShopOfficeOut[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setOffices(await shopApi.offices()); }
    catch (error) { setLoadError(apiErrorMessage(error, "無法載入處室，請重試。")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy || !name.trim()) return;
    setBusy(true); setSaveError(""); setMessage("");
    try {
      const office = await shopApi.createOffice({ name: name.trim() });
      form.reset();
      setOffices((rows) => [...rows, office]); setName(""); setMessage(`已新增「${office.name}」。`);
    } catch (error) { setSaveError(apiErrorMessage(error, "處室未新增，請重試。")); }
    finally { setBusy(false); }
  };

  return <section className="max-w-3xl" aria-label="教師處室選項管理">
    <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>教師處室選項</h2>
    <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>老師可在商品頁選擇這些辦公室／處室。停用後不再提供選取，既有訂單保留原名稱。</p>
    <p id="office-sort-help" className="mt-2 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>顯示順序的數字越小越前面，修改後請按「儲存設定」。新處室預設排在最後。</p>
    {loading ? <p className="mt-4" role="status">正在載入處室…</p> : loadError ? <div className="mt-4" role="alert">
      <p>{loadError}</p><button type="button" className="btn btn-secondary min-h-11 mt-2" onClick={() => void load()}>重新載入處室</button>
    </div> : <>
      <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={create}>
        <label className="flex-1 min-w-0 basis-52 text-sm" style={{ color: "var(--text-primary)" }}>新增處室名稱
          <input className="input mt-1 w-full min-h-11" placeholder="例如：國文科、學務處" maxLength={100} required value={name} disabled={busy}
            onChange={(event) => { setName(event.target.value); setMessage(""); }} />
        </label>
        <button type="submit" className="btn btn-primary min-h-11" disabled={busy || !name.trim()}>{busy ? "新增中…" : "新增處室"}</button>
      </form>
      {saveError && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{saveError}</p>}
      {message && <p role="status" className="mt-2 text-sm">{message}</p>}
      {offices.length === 0 ? <p className="mt-6 text-sm">尚未設定處室，請先新增老師可選的選項。</p>
        : <ul className="mt-4">{offices.map((office) => <OfficeRow key={office.id} office={office}
          onSaved={(updated) => setOffices((rows) => rows.map((row) => row.id === updated.id ? updated : row)
            .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))} />)}</ul>}
    </>}
  </section>;
}
