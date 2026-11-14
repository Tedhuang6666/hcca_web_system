"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiErrorMessage, shopApi, shopSheetApi } from "@/lib/api";
import type { ProductCategoryOut, ProductOut, ShopSheetConfig, ShopSheetRowOut, ShopSheetSourceOut } from "@/lib/types";

const defaultConfig: ShopSheetConfig = {
  identity_column: "時間戳記", name_column: "姓名", email_column: "電子郵件地址",
  office_column: "辦公室", other_office_column: "若所屬辦公室未在上列選項",
  ignored_columns: ["職稱"], product_columns: {}, max_rows: 10000,
};
const statusLabels: Record<string, string> = { imported: "已匯入", review: "待確認", changed: "填答已變更" };

export default function ShopSheetImportPanel({ categories }: { categories: ProductCategoryOut[] }) {
  const [sources, setSources] = useState<ShopSheetSourceOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<ShopSheetSourceOut | null>(null);
  const [name, setName] = useState("教師與組織預購");
  const [url, setUrl] = useState("https://docs.google.com/spreadsheets/d/1otp3Zr-1iRPE2TRzr0Iu5NQmf3XgrkYE_JUT0LQ8f18/edit");
  const [sheetName, setSheetName] = useState("表單回覆 1");
  const [categoryId, setCategoryId] = useState("");
  const [config, setConfig] = useState<ShopSheetConfig>({ ...defaultConfig });
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [productError, setProductError] = useState("");
  const [mappingHeader, setMappingHeader] = useState("");
  const [mappingProduct, setMappingProduct] = useState("");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [rows, setRows] = useState<ShopSheetRowOut[]>([]);
  const [rowLoading, setRowLoading] = useState(false);
  const [rowError, setRowError] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError("");
    shopSheetApi.list().then((items) => { if (active) setSources(items); })
      .catch((cause) => { if (active) setLoadError(apiErrorMessage(cause, "無法載入來源，請重試。")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    setProducts([]); setProductError(""); setMappingProduct("");
    if (categoryId) shopApi.listProducts({ category_id: categoryId }).then((items) => { if (active) setProducts(items); })
      .catch((cause) => { if (active) setProductError(apiErrorMessage(cause, "商品選項載入失敗，請重選活動。")); });
    return () => { active = false; };
  }, [categoryId]);

  useEffect(() => {
    if (!selectedSource) return;
    let active = true;
    setRowLoading(true); setRowError(""); setRows([]);
    shopSheetApi.rows(selectedSource, offset).then((items) => { if (active) setRows(items); })
      .catch((cause) => { if (active) setRowError(apiErrorMessage(cause, "無法載入匯入結果，請重試。")); })
      .finally(() => { if (active) setRowLoading(false); });
    return () => { active = false; };
  }, [selectedSource, offset, refresh]);

  function edit(source: ShopSheetSourceOut) {
    setEditing(source); setName(source.name);
    setUrl(`https://docs.google.com/spreadsheets/d/${source.spreadsheet_id}/edit`);
    setSheetName(source.sheet_name); setCategoryId(source.category_id);
    setConfig({ ...defaultConfig, ...source.config }); setError(""); setMessage("");
    setFormError(""); setFormMessage("");
    requestAnimationFrame(() => {
      nameInput.current?.focus({ preventScroll: true });
      nameInput.current?.scrollIntoView({ block: "center" });
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const spreadsheetId = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,200})(?:\/|$)/)?.[1];
    if (!spreadsheetId) { setFormError("請貼上有效的 Google 試算表網址。"); return; }
    setBusy(true); setFormError(""); setFormMessage("");
    try {
      const body = { name: name.trim(), spreadsheet_id: spreadsheetId, sheet_name: sheetName.trim(),
        category_id: categoryId, config, enabled: editing?.enabled ?? false };
      const saved = editing ? await shopSheetApi.configure(editing.id, body) : await shopSheetApi.create(body);
      setEditing(saved); setSelectedSource(saved.id); setOffset(0); setRefresh((value) => value + 1);
      setFormMessage(editing ? "同步設定已儲存。" : "來源已新增。可先同步一次核對結果，再啟用自動同步。");
    } catch (cause) { setFormError(apiErrorMessage(cause, "設定未儲存，請重試。")); }
    finally { setBusy(false); }
  }

  async function act(source: ShopSheetSourceOut, action: "sync" | "enable") {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (action === "sync") {
        const result = await shopSheetApi.sync(source.id);
        setSelectedSource(source.id); setOffset(0);
        setMessage(`本次同步：新增 ${result.imported ?? 0} 筆、更新 ${result.updated ?? 0} 筆、略過 ${result.skipped ?? 0} 筆、待確認 ${result.review ?? 0} 筆。`);
      } else {
        const updated = await shopSheetApi.enable(source.id, !source.enabled);
        if (editing?.id === updated.id) setEditing(updated);
        setMessage(updated.enabled ? "已啟用，每分鐘同步新填答與原回覆的修改。" : "自動同步已停用。");
      }
      setRefresh((value) => value + 1);
    } catch (cause) { setError(apiErrorMessage(cause, "操作失敗，請重試。")); }
    finally { setBusy(false); }
  }

  return <section className="max-w-5xl space-y-8" aria-label="組織預購同步管理">
    <p className="max-w-3xl text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
      將表單填答同步為預購，寄送通知並於交貨收款；未收款訂單隨原回覆更新。無法辨識的填答列為待確認。
    </p>
    {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    {message && <p role="status" className="text-sm leading-6">{message}</p>}
    <div>
      <h2 className="text-lg font-semibold">同步來源</h2>
      {loading ? <p role="status" className="mt-4">正在載入來源…</p> : loadError ? <div role="alert" className="mt-4">
        <p>{loadError}</p><button type="button" className="btn btn-secondary min-h-11 mt-2" onClick={() => setRefresh((value) => value + 1)}>重新載入來源</button>
      </div> : sources.length === 0 ? <p className="mt-3 text-sm">尚未設定來源</p> : <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {sources.map((source) => <li key={source.id} className="py-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{source.name}</h3>
            <span className="text-sm">{source.enabled ? "每分鐘自動同步" : "自動同步已停用"}</span></div>
          <p className="text-sm break-words" style={{ color: "var(--text-secondary)" }}>{source.sheet_name} · {source.last_synced_at ? `上次同步 ${new Date(source.last_synced_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` : "尚未同步"}</p>
          {source.last_error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{source.last_error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={() => void act(source, "sync")}>同步一次<span className="sr-only">：{source.name}</span></button>
            <button type="button" className="btn btn-secondary min-h-11" disabled={busy} onClick={() => void act(source, "enable")}>{source.enabled ? "停用自動同步" : "啟用自動同步"}<span className="sr-only">：{source.name}</span></button>
            <button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={() => edit(source)}>編輯設定<span className="sr-only">：{source.name}</span></button>
            <button type="button" className="btn btn-ghost min-h-11" onClick={() => { setSelectedSource(source.id); setOffset(0); }}>查看結果<span className="sr-only">：{source.name}</span></button>
            <a className="btn btn-ghost min-h-11" href={`https://docs.google.com/spreadsheets/d/${source.spreadsheet_id}/edit`} target="_blank" rel="noreferrer">開啟試算表</a>
          </div>
        </li>)}
      </ul>}
    </div>
    {selectedSource && <section aria-label="匯入結果" className="space-y-3">
      <h2 className="text-lg font-semibold">匯入結果</h2>
      <p className="text-sm leading-6">待確認的填答可修正原回覆後重新同步。已成立且未收款的訂單會自動更新；已收款、已截止或無法辨識的變更會保留原訂單，請依原因核對。</p>
      {rowLoading ? <p role="status">正在載入結果…</p> : rowError ? <div role="alert"><p>{rowError}</p>
        <button type="button" className="btn btn-secondary min-h-11" onClick={() => setRefresh((value) => value + 1)}>重新載入結果</button></div>
        : rows.length === 0 ? <p className="text-sm">目前沒有匯入紀錄。</p> : <ul className="divide-y" style={{ borderColor: "var(--border)" }}>{rows.map((row) => <li key={row.id} className="py-3 text-sm leading-6">
          <p className="font-medium">第 {row.row_number} 列 · {statusLabels[row.status] ?? row.status}</p>
          {row.error && <p style={{ color: "var(--danger)" }}>{row.error}</p>}
          {row.order_ids.map((id) => <Link key={id} className="inline-flex min-h-11 items-center underline underline-offset-4 mr-4" href={`/shop/orders/${id}`}>查看訂單</Link>)}
        </li>)}</ul>}
      <div className="flex gap-3"><button type="button" className="btn btn-secondary min-h-11" disabled={rowLoading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 100))}>上一頁</button>
        <button type="button" className="btn btn-secondary min-h-11" disabled={rowLoading || rows.length < 100} onClick={() => setOffset((value) => value + 100)}>下一頁</button></div>
    </section>}
    <form onSubmit={save} className="space-y-4" aria-label="同步來源設定">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-lg font-semibold">{editing ? `編輯：${editing.name}` : "新增來源"}</h2>
        {editing && <button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={() => { setEditing(null); setName(""); setConfig({ ...defaultConfig }); setMessage(""); setFormError(""); setFormMessage(""); }}>改為新增來源</button>}</div>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">來源名稱<input ref={nameInput} className="input mt-1 min-h-11 w-full text-base" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="text-sm">活動<select className="input mt-1 min-h-11 w-full text-base" required value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setConfig((current) => ({ ...current, product_columns: {} })); }}>
          <option value="">請選擇對應的活動</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="text-sm sm:col-span-2">Google 試算表網址<input type="url" className="input mt-1 min-h-11 w-full text-base" required readOnly={Boolean(editing)} value={url} onChange={(event) => setUrl(event.target.value)} /></label>
        <label className="text-sm">工作表分頁名稱<input className="input mt-1 min-h-11 w-full text-base" required readOnly={Boolean(editing)} maxLength={100} value={sheetName} onChange={(event) => setSheetName(event.target.value)} /></label>
      </fieldset>
      <details>
        <summary className="cursor-pointer min-h-11 py-3 text-sm font-medium">欄位名稱與商品對應</summary>
        <p className="text-sm leading-6 mb-4">欄位名稱自動對應；不同名或重複時須手動指定。</p>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          {([ ["name_column", "姓名欄名"], ["email_column", "Email 欄名"], ["office_column", "辦公室欄名"], ["identity_column", "唯一識別欄名"] ] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input className="input mt-1 w-full min-h-11 text-base" required readOnly={key === "identity_column" && Boolean(editing)} value={config[key] ?? ""} onChange={(event) => setConfig((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
          <label className="text-sm">補填辦公室欄名<input className="input mt-1 w-full min-h-11 text-base" value={config.other_office_column ?? ""} onChange={(event) => setConfig((current) => ({ ...current, other_office_column: event.target.value || null }))} /></label>
          <label className="text-sm">不作為商品的欄位（逗號分隔）<input className="input mt-1 w-full min-h-11 text-base" value={(config.ignored_columns ?? []).join(",")} onChange={(event) => setConfig((current) => ({ ...current, ignored_columns: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) }))} /></label>
        </fieldset>
        <p className="text-sm mt-4">識別欄位須保持固定且每筆唯一；同一秒重複填答會列為待確認。</p>
        {productError && <p role="alert" className="text-sm mt-3">{productError}</p>}
        <div className="grid gap-3 sm:grid-cols-2 mt-4">
          <label className="text-sm">試算表商品欄名<input className="input mt-1 min-h-11 w-full text-base" value={mappingHeader} disabled={busy} onChange={(event) => setMappingHeader(event.target.value)} /></label>
          <label className="text-sm">對應商品<select className="input mt-1 min-h-11 w-full text-base" value={mappingProduct} disabled={busy} onChange={(event) => setMappingProduct(event.target.value)}><option value="">請選擇商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        </div>
        <button type="button" className="btn btn-secondary min-h-11 mt-3" disabled={busy || !mappingHeader.trim() || !mappingProduct} onClick={() => { setConfig((current) => ({ ...current, product_columns: { ...current.product_columns, [mappingHeader.trim()]: mappingProduct } })); setMappingHeader(""); }}>加入欄位對應</button>
        <ul className="mt-3 space-y-2">{Object.entries(config.product_columns ?? {}).map(([header, id]) => <li key={header} className="text-sm break-words">{header} → {products.find((product) => product.id === id)?.name ?? "已設定商品"}
          <button type="button" className="btn btn-ghost min-h-11 ml-2" disabled={busy} aria-label={`移除${header}的對應`} onClick={() => setConfig((current) => ({ ...current, product_columns: Object.fromEntries(Object.entries(current.product_columns ?? {}).filter(([key]) => key !== header)) }))}>移除</button></li>)}</ul>
      </details>
      <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>同步會建立訂單並寄出通知信。請先確認自動收集 Email 已開啟，且系統具有試算表讀取權限。</p>
      {formError && <p role="alert" className="text-sm leading-6" style={{ color: "var(--danger)" }}>{formError}</p>}
      {formMessage && <p role="status" className="text-sm leading-6">{formMessage}</p>}
      <button type="submit" className="btn btn-primary min-h-11" disabled={busy || !categoryId}>{busy ? "處理中…" : editing ? "儲存同步設定" : "新增同步來源"}</button>
    </form>
  </section>;
}
