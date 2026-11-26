"use client";

import { useEffect, useRef, useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderSummaryRow } from "@/lib/types";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import Modal from "@/components/ui/Modal";
import { money } from "@/lib/shop-class-orders";

type Confirmation = { row: OrderSummaryRow; paid: boolean };
type CollectionFilters = Pick<Parameters<typeof shopApi.orderSummary>[0],
  "grade" | "class_id" | "product_id" | "status" | "is_paid" | "date_from" | "date_to">;

export default function ClassPaymentWorkspace({ refreshKey, disabled, onChanged, onBusyChange,
  onViewClass, filters = {},
}: {
  refreshKey: number;
  disabled: boolean;
  onChanged: () => void;
  onBusyChange: (busy: string | null) => void;
  onViewClass?: (classId: string, label: string) => void;
  filters?: CollectionFilters;
}) {
  const { grade, class_id: classId, product_id: productId, status, is_paid: isPaid,
    date_from: dateFrom, date_to: dateTo } = filters;
  const requestKey = JSON.stringify([grade, classId, productId, status, isPaid, dateFrom, dateTo]);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ key: string; rows: OrderSummaryRow[] } | null>(null);
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
    let active = true;
    setResult(null);
    setError("");
    const activeFilters: CollectionFilters = {
      grade, class_id: classId, product_id: productId, status, is_paid: isPaid,
      date_from: dateFrom, date_to: dateTo,
    };
    const hasActiveFilters = Object.values(activeFilters).some(Boolean);
    Promise.all([
      shopApi.orderSummary({ group_by: "class" }),
      hasActiveFilters ? shopApi.orderSummary({ group_by: "class", ...activeFilters }) : Promise.resolve(null),
    ]).then(([summary, matchingSummary]) => {
      if (!active) return;
      const matchingClassIds = matchingSummary
        ? new Set(matchingSummary.rows.map((row) => row.key)) : null;
      setResult({
        key: requestKey,
        rows: summary.rows.filter((row) => row.key !== "none"
          && (matchingClassIds === null || matchingClassIds.has(row.key))),
      });
    }).catch((cause) => {
      if (active) setError(apiErrorMessage(cause, "無法載入班級收款金額，請重試。"));
    });
    return () => { active = false; };
  }, [requestKey, retry, refreshKey, grade, classId, productId, status, isPaid, dateFrom, dateTo]);

  const rows = result?.key === requestKey
    ? result.rows.filter((row) => row.label.includes(search.trim())) : [];
  const loading = result?.key !== requestKey && !error;
  const openConfirmation = (row: OrderSummaryRow, paid: boolean) => {
    if (disabled || savingRef.current) return;
    if ((paid ? row.unpaid_amount : row.paid_amount) <= 0) return;
    setSaveError("");
    setReceivedInput(String(row.unpaid_amount));
    setConfirmation({ row, paid });
  };
  const submit = async () => {
    if (!confirmation || savingRef.current) return;
    const { row, paid } = confirmation;
    const received = Number(receivedInput);
    if (paid && (!receivedInput.trim() || !Number.isSafeInteger(received) || received <= 0 || received > row.unpaid_amount)) {
      setSaveError("請輸入大於零、且不超過待收金額的整數。");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    onBusyChange("class-payment");
    try {
      await shopApi.setClassPaid(row.key, paid, paid && received < row.unpaid_amount
        ? { received_amount: received, expected_unpaid_amount: row.unpaid_amount }
        : undefined);
      setMessage(paid && received < row.unpaid_amount
        ? `${row.label}已收 ${money(received)}，剩餘 ${money(row.unpaid_amount - received)} 已列入補收款區的整班尾款。`
        : `${row.label}的全班商品款項已${paid ? "確認收款" : "撤銷收款確認"}。`);
      setConfirmation(null);
      setRetry((value) => value + 1);
      onChanged();
    } catch (cause) {
      setSaveError(apiErrorMessage(cause, "更新班級收款失敗，請重新核對後重試。"));
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
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>收款確認會套用到該班所有商品。</p>
    </div>
    <label className="grid max-w-md gap-1 text-sm">搜尋收款班級
      <input type="search" className="input min-h-11" placeholder="輸入班級名稱" value={search}
        disabled={disabled} onChange={(event) => setSearch(event.target.value)} />
    </label>
    {loading ? <p role="status">正在載入班級收款金額…</p>
      : error ? <div role="alert" className="flex flex-wrap items-center gap-2"><p>{error}</p>
        <button type="button" className="btn btn-ghost min-h-11" onClick={() => setRetry((value) => value + 1)}>重試收款名單</button></div>
        : rows.length === 0 ? <p role="status">目前沒有符合的班級訂單。</p>
          : <ul className="divide-y" style={{ borderColor: "var(--border)" }} aria-label="班級收款名單">
            {rows.map((row) => <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <h3 className="font-semibold">{onViewClass ? <button type="button"
                  className="min-h-11 text-left underline underline-offset-4" disabled={disabled}
                  data-class-orders-id={row.key} data-class-orders-source="collection"
                  aria-label={`查看${row.label}訂購明細`} onClick={() => onViewClass(row.key, row.label)}>
                  {row.label}
                </button> : row.label}</h3>
                <p className="text-sm tabular-nums">待收 {money(row.unpaid_amount)}{row.paid_amount > 0
                  && <span className="ml-2" style={{ color: "var(--text-secondary)" }}>已確認 {money(row.paid_amount)}</span>}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {row.unpaid_amount > 0 ? <button type="button" className="btn btn-secondary min-h-11 px-3 text-sm" disabled={disabled}
                  onClick={() => openConfirmation(row, true)} aria-label={`核對${row.label}收款`}>核對收款 {money(row.unpaid_amount)}</button>
                  : <span className="text-sm" role="status">已收齊</span>}
                <AnimatedDownloadButton request={() => {
                  setReceiptError("");
                  return shopApi.downloadClassReceipt(row.key);
                }} label="全班簽收單 PDF" aria-label={`下載${row.label}全班簽收單 PDF`} disabled={disabled}
                  className="btn btn-ghost min-h-11 px-3 text-sm" onError={(cause) => setReceiptError(apiErrorMessage(cause, "簽收單下載失敗，請重試。"))} />
                {row.paid_amount > 0 && <button type="button" className="btn btn-ghost min-h-11 text-sm" disabled={disabled}
                  onClick={() => openConfirmation(row, false)} aria-label={`撤銷${row.label}全班收款確認`}>撤銷全班收款</button>}
              </div>
            </li>)}
          </ul>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {receiptError && <p role="alert" className="text-sm">{receiptError}</p>}
    {confirmation && <Modal title={confirmation.paid ? "核對全班收款" : "撤銷全班收款"} size="sm" mobileFullscreen={false}
      onClose={() => { if (!savingRef.current) setConfirmation(null); }}>
      <p className="mb-4 font-semibold">{confirmation.row.label}・全部商品</p>
      <p className="flex items-baseline justify-between gap-3">{confirmation.paid ? "待收總額" : "撤銷總額"}
        <strong className="text-lg tabular-nums">{money(confirmation.paid ? confirmation.row.unpaid_amount : confirmation.row.paid_amount)}</strong></p>
      {confirmation.paid && <div className="mt-4 space-y-2">
        <label htmlFor="class-received-amount" className="block text-sm font-medium">本次實收金額（元）</label>
        <input id="class-received-amount" type="number" inputMode="numeric" min="1" step="1"
          max={confirmation.row.unpaid_amount} className="input min-h-11 w-full" value={receivedInput} disabled={saving}
          aria-describedby="class-remaining-amount" onChange={(event) => { setReceivedInput(event.target.value); setSaveError(""); }} />
        <p id="class-remaining-amount" className="text-sm" style={{ color: "var(--text-secondary)" }}>
          待補收 {money(Math.max(0, confirmation.row.unpaid_amount - (Number(receivedInput) || 0)))}。未收齊的金額會以整班尾款列入補收款區。
        </p>
      </div>}
      <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>{confirmation.paid
        ? "請核對本次實際收到的金額。" : "撤銷後，該班全部商品款項會重新列為待收。"}</p>
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
