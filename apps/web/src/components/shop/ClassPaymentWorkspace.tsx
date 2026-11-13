"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ActivityOut, CatalogCategoryOut, OrderSummaryRow } from "@/lib/types";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import CollectionActivityPicker from "@/components/shop/CollectionActivityPicker";
import Modal from "@/components/ui/Modal";
import { money } from "@/lib/shop-class-orders";
import { isOrderingClosed } from "@/lib/shop-order-scope";

type Scope = { key: string; label: string; activityId: string | null; categoryId?: string; topics: string[]; closed: boolean };
type Entry = { scope: Scope; row: OrderSummaryRow };
type Confirmation = { entries: Entry[]; paid: boolean; classLabel: string };

export default function ClassPaymentWorkspace({ catalog, activities, optionsLoading, optionsError, refreshKey, disabled,
  onChanged, onBusyChange, onViewClass, selectedScopeKey, onScopeChange,
}: {
  catalog: CatalogCategoryOut[]; activities: ActivityOut[]; optionsLoading: boolean; optionsError: boolean;
  refreshKey: number; disabled: boolean; onChanged: () => void; onBusyChange: (busy: string | null) => void;
  onViewClass?: (classId: string, label: string, scope: { key: string; label: string }) => void;
  selectedScopeKey?: string | null;
  onScopeChange?: (scope: { key: string; label: string }) => void;
}) {
  const scopes = useMemo(() => {
    const groups = new Map<string, Scope>();
    for (const activity of activities) groups.set(activity.id, {
      key: activity.id, label: activity.name, activityId: activity.id, topics: [],
      closed: isOrderingClosed({ ...activity, activity_status: activity.status }),
    });
    for (const category of catalog) {
      const key = category.activity_id ?? `category:${category.id}`;
      const group = groups.get(key) ?? {
        key, label: category.activity_name ?? category.name, activityId: category.activity_id ?? null,
        categoryId: category.activity_id ? undefined : category.id, topics: [], closed: true,
      };
      group.topics.push(category.name);
      // 有任一主題仍可訂購時，整個活動仍列在目前活動。
      group.closed = group.topics.length === 1 ? isOrderingClosed(category) : group.closed && isOrderingClosed(category);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [activities, catalog]);
  const [localSelectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedKey = selectedScopeKey === undefined ? localSelectedKey : selectedScopeKey;
  const selectedScopes = useMemo(() => scopes.filter((scope) => scope.key === selectedKey), [scopes, selectedKey]);
  const selectionKey = selectedScopes.map((scope) => scope.key).join(",");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ key: string; entries: Entry[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [receivedInput, setReceivedInput] = useState("");

  useEffect(() => {
    if (!selectedScopes.length || optionsLoading || optionsError) return;
    let active = true;
    setResult(null);
    setError("");
    Promise.all(selectedScopes.map(async (scope) => {
      const summary = await shopApi.orderSummary({ group_by: "class", ...(scope.categoryId
        ? { category_id: scope.categoryId } : { activity_id: scope.activityId! }) });
      return summary.rows.map((row) => ({ scope, row }));
    }))
      .then((entries) => { if (active) setResult({ key: selectionKey, entries: entries.flat() }); })
      .catch((cause) => { if (active) setError(apiErrorMessage(cause, "無法載入本次活動的班級金額，請重試。")); });
    return () => { active = false; };
  }, [selectionKey, selectedScopes, retry, refreshKey, optionsLoading, optionsError]);

  const classes = new Map<string, { label: string; entries: Entry[] }>();
  if (result?.key === selectionKey) for (const entry of result.entries) {
    if (entry.row.key === "none" || !entry.row.label.includes(search.trim())) continue;
    const item = classes.get(entry.row.key) ?? { label: entry.row.label, entries: [] };
    item.entries.push(entry);
    classes.set(entry.row.key, item);
  }
  const loading = Boolean(selectedScopes.length && result?.key !== selectionKey && !error);
  const openConfirmation = (entries: Entry[], paid: boolean) => {
    if (disabled || savingRef.current) return;
    const targets = entries.filter(({ row }) => (paid ? row.unpaid_amount : row.paid_amount) > 0);
    if (!targets.length) return;
    setSaveError("");
    setReceivedInput(String(targets.reduce((sum, { row }) => sum + row.unpaid_amount, 0)));
    setConfirmation({ entries: targets, paid, classLabel: targets[0].row.label });
  };
  const submit = async () => {
    if (!confirmation || savingRef.current) return;
    const unpaid = confirmation.entries.reduce((sum, { row }) => sum + row.unpaid_amount, 0);
    const received = Number(receivedInput);
    if (confirmation.paid && (!receivedInput.trim() || !Number.isSafeInteger(received) || received <= 0 || received > unpaid)) {
      setSaveError("請輸入大於零、且不超過待收金額的整數。");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    onBusyChange("class-payment");
    const target = confirmation;
    const failed: Entry[] = [];
    try {
      // 同一班級的請求依序執行，避免班級鎖互相等待；成功項目不再重送。
      for (const entry of target.entries) {
        try {
          if (target.paid && received < unpaid) {
            await shopApi.setClassPaid(entry.row.key, true, entry.scope.activityId, entry.scope.categoryId,
              { received_amount: received, expected_unpaid_amount: entry.row.unpaid_amount });
          } else {
            await shopApi.setClassPaid(entry.row.key, target.paid, entry.scope.activityId, entry.scope.categoryId);
          }
        } catch {
          failed.push(entry);
        }
      }
      const completed = target.entries.filter((entry) => !failed.includes(entry));
      if (completed.length) setMessage(target.paid && received < unpaid
        ? `${target.classLabel}已收 ${money(received)}，剩餘 ${money(unpaid - received)} 已列入補收款區的整班尾款。`
        : `${target.classLabel}的「${completed.map((entry) => entry.scope.label).join("、")}」已${target.paid ? "確認收款" : "撤銷收款確認"}。`);
      if (failed.length) {
        setConfirmation({ ...target, entries: failed });
        setSaveError(`${completed.length} 個活動已完成，${failed.length} 個未完成。下方只保留未完成項目，可重新核對後重試。`);
      } else setConfirmation(null);
      setRetry((value) => value + 1);
      onChanged();
    } finally {
      savingRef.current = false;
      setSaving(false);
      onBusyChange(null);
    }
  };

  return <section aria-labelledby="class-collection-heading" className="mb-6 space-y-4 rounded-lg p-4 sm:p-5"
    style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
    <div>
      <h2 id="class-collection-heading" className="text-lg font-semibold">登記班級收款</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>先選一個活動，再找到班級核對該活動的款項。</p>
    </div>
    <CollectionActivityPicker options={scopes} selected={selectedKey} disabled={disabled || saving || Boolean(confirmation) || optionsLoading || optionsError}
      onChange={(key) => {
        const scope = scopes.find((item) => item.key === key)!;
        setSelectedKey(key); onScopeChange?.(scope);
        setMessage(""); setError(""); setReceiptError(""); setResult(null);
      }} />
    {optionsLoading ? <p role="status">正在載入收款活動…</p>
      : optionsError ? <p role="alert">無法載入收款活動，請使用頁面上方的重新載入。</p>
        : !selectedScopes.length ? <p role="status" className="text-sm" style={{ color: "var(--text-secondary)" }}>請先選擇本次要收款的活動。</p>
          : <>
            <div className="space-y-1" aria-label="本次收款範圍">
              <p className="font-semibold">本次收款：{selectedScopes.map((scope) => scope.label).join("、")}</p>
              {selectedScopes.some((scope) => scope.topics.length > 1) && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{selectedScopes.filter((scope) => scope.topics.length > 1).map((scope) => `${scope.label}包含：${scope.topics.join("、")}`).join("；")}</p>}
            </div>
            <label className="grid max-w-md gap-1 text-sm">搜尋收款班級
              <input type="search" className="input min-h-11" placeholder="輸入班級名稱" value={search}
                disabled={disabled} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {loading ? <p role="status">正在載入所選活動的班級金額…</p>
              : error ? <div role="alert" className="flex flex-wrap items-center gap-2"><p>{error}</p>
                <button type="button" className="btn btn-ghost min-h-11" onClick={() => setRetry((value) => value + 1)}>重試收款名單</button></div>
                : classes.size === 0 ? <p role="status">目前沒有符合的班級訂單。</p>
                  : <ul className="divide-y" style={{ borderColor: "var(--border)" }} aria-label="班級收款名單">
                    {[...classes].map(([classId, item]) => {
                      const unpaid = item.entries.reduce((sum, { row }) => sum + row.unpaid_amount, 0);
                      const paid = item.entries.reduce((sum, { row }) => sum + row.paid_amount, 0);
                      return <li key={classId} className="space-y-3 py-4">
                        <h3 className="font-semibold">{onViewClass ? <button type="button"
                          className="min-h-11 text-left underline underline-offset-4" disabled={disabled}
                          data-class-orders-id={classId} data-class-orders-source="collection"
                          aria-label={`查看${item.label}訂購明細`} onClick={() => onViewClass(classId, item.label, item.entries[0].scope)}>
                          {item.label}
                        </button> : item.label}</h3>
                        <dl className="max-w-md space-y-2 text-sm">{item.entries.map(({ scope, row }) => <div key={scope.key} className="flex flex-wrap justify-between gap-x-4">
                          <dt>{scope.label}</dt><dd className="tabular-nums">待收 {money(row.unpaid_amount)}{row.paid_amount > 0 && <span className="ml-2" style={{ color: "var(--text-secondary)" }}>已確認 {money(row.paid_amount)}</span>}</dd>
                        </div>)}</dl>
                        <div className="flex flex-wrap items-center gap-2">
                          {unpaid > 0 ? <button type="button" className="btn btn-secondary min-h-11 px-3 text-sm" disabled={disabled}
                            onClick={() => openConfirmation(item.entries, true)} aria-label={`核對${item.label}收款`}>核對{selectedScopes[0].label}收款 {money(unpaid)}</button>
                            : <span className="text-sm" role="status">已收齊</span>}
                          <details>
                            <summary className="min-h-11 cursor-pointer py-3 text-sm">簽收單與其他操作</summary>
                            <div className="flex flex-wrap gap-2">
                              {item.entries.map(({ scope }) => <AnimatedDownloadButton key={scope.key} request={() => {
                                setReceiptError("");
                                return scope.categoryId ? shopApi.downloadClassReceipts({ category_id: scope.categoryId }, [classId])
                                  : shopApi.downloadClassReceipt(classId, scope.activityId);
                              }} label={`${scope.label}簽收單 PDF`} aria-label={`下載${item.label}的${scope.label}簽收單 PDF`} disabled={disabled}
                                className="btn btn-ghost min-h-11 px-3 text-sm" onError={(cause) => setReceiptError(apiErrorMessage(cause, "簽收單下載失敗，請重試。"))} />)}
                              {paid > 0 && <button type="button" className="btn btn-ghost min-h-11 text-sm" disabled={disabled}
                                onClick={() => openConfirmation(item.entries, false)} aria-label={`撤銷${item.label}所選活動收款確認`}>撤銷所選活動收款</button>}
                            </div>
                          </details>
                        </div>
                      </li>;
                    })}
                  </ul>}
          </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {receiptError && <p role="alert" className="text-sm">{receiptError}</p>}
    {confirmation && <Modal title={confirmation.paid ? "核對班級收款" : "撤銷班級收款"} size="sm" mobileFullscreen={false}
      onClose={() => { if (!savingRef.current) setConfirmation(null); }}>
      <p className="mb-4 font-semibold">{confirmation.classLabel}</p>
      <dl className="space-y-3 text-sm">{confirmation.entries.map(({ scope, row }) => <div key={scope.key} className="flex flex-wrap justify-between gap-x-4">
        <dt>{scope.label}</dt><dd className="font-semibold tabular-nums">{money(confirmation.paid ? row.unpaid_amount : row.paid_amount)}</dd>
      </div>)}</dl>
      <p className="mt-4 flex items-baseline justify-between gap-3">{confirmation.paid ? "本次合計" : "撤銷合計"}<strong className="text-lg tabular-nums">{money(confirmation.entries.reduce((sum, { row }) => sum + (confirmation.paid ? row.unpaid_amount : row.paid_amount), 0))}</strong></p>
      {confirmation.paid && <div className="mt-4 space-y-2">
        <label htmlFor="class-received-amount" className="block text-sm font-medium">本次實收金額（元）</label>
        <input id="class-received-amount" type="number" inputMode="numeric" min="1" step="1"
          max={confirmation.entries.reduce((sum, { row }) => sum + row.unpaid_amount, 0)}
          className="input min-h-11 w-full" value={receivedInput} disabled={saving}
          aria-describedby="class-remaining-amount" onChange={(event) => { setReceivedInput(event.target.value); setSaveError(""); }} />
        <p id="class-remaining-amount" className="text-sm" style={{ color: "var(--text-secondary)" }}>
          待補收 {money(Math.max(0, confirmation.entries.reduce((sum, { row }) => sum + row.unpaid_amount, 0) - (Number(receivedInput) || 0)))}。未收齊的金額會以整班尾款列入補收款區。
        </p>
      </div>}
      <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>{confirmation.paid ? "請核對本次實際收到的金額。" : "撤銷後，上列活動款項會重新列為待收。"}只更新上列活動。</p>
      {saveError && <p role="alert" className="mt-3 text-sm">{saveError}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-ghost min-h-11" disabled={saving} onClick={() => setConfirmation(null)}>返回核對</button>
        <button type="button" className="btn btn-primary min-h-11" disabled={saving} onClick={() => void submit()}>
          {saving ? "處理中…" : confirmation.paid ? "確認收到款項" : "確認撤銷收款"}
        </button>
      </div>
    </Modal>}
  </section>;
}
