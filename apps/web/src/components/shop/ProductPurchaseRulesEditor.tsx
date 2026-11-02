"use client";

import { useEffect, useId, useState } from "react";
import { shopApi } from "@/lib/api";
import type { ProductPurchaseGroupOptionOut, ProductPurchasePermissionOut, ProductPurchaseRules } from "@/lib/types";

export type PurchaseRulesDraft = Required<ProductPurchaseRules>;
export const emptyPurchaseRules: PurchaseRulesDraft = {
  allowed_grades: [], required_permissions: [], allowed_identifiers: [], blocked_identifiers: [],
  exclusive_group: null, designated_only: false,
  exclusive_product_ids: [],
};

function identifiers(text: string): string[] {
  return [...new Set(text.split(/[\s,，;；]+/u).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export default function ProductPurchaseRulesEditor({ value, onChange, activityId, categoryId, productId, disabled }: {
  value: PurchaseRulesDraft;
  onChange: (value: PurchaseRulesDraft) => void;
  activityId: string | null;
  categoryId: string;
  productId: string | null;
  disabled: boolean;
}) {
  const id = useId();
  const [allowedText, setAllowedText] = useState(value.allowed_identifiers.join("\n"));
  const [blockedText, setBlockedText] = useState(value.blocked_identifiers.join("\n"));
  const [permissions, setPermissions] = useState<ProductPurchasePermissionOut[]>([]);
  const [permissionsState, setPermissionsState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [products, setProducts] = useState<ProductPurchaseGroupOptionOut[]>([]);
  const [groupState, setGroupState] = useState<"loading" | "ready" | "error">("loading");
  const [groupAttempt, setGroupAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    shopApi.purchaseGroupOptions(categoryId).then((items) => {
      if (active) { setProducts(items); setGroupState("ready"); }
    }).catch(() => { if (active) setGroupState("error"); });
    return () => { active = false; };
  }, [categoryId, groupAttempt]);
  useEffect(() => {
    let active = true;
    shopApi.purchasePermissions(activityId).then((options) => {
      if (active) { setPermissions(options); setPermissionsState("ready"); }
    }).catch(() => { if (active) setPermissionsState("error"); });
    return () => { active = false; };
  }, [activityId, attempt]);

  return <fieldset disabled={disabled} className="space-y-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
    <legend className="px-1 text-base font-semibold">購買資格</legend>
    <p id={`${id}-help`} className="text-sm" style={{ color: "var(--text-secondary)" }}>
      留空表示不限制。設定多種條件時須全部符合；同一欄位符合任一項即可。禁止名單優先，班代與家人代訂也會檢查學生資格。
    </p>
    <div className="space-y-2">
      <fieldset aria-describedby={`${id}-group-help`}>
        <legend className="text-sm font-medium">同組合計限購一件</legend>
        {groupState === "loading" ? <p role="status" className="py-2 text-sm">正在讀取主題商品…</p>
          : groupState === "error" ? <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            商品清單讀取失敗，原有選擇已保留。<button type="button" className="min-h-11 underline" onClick={() => {
              setGroupState("loading"); setGroupAttempt((current) => current + 1);
            }}>重新讀取商品</button>
          </p> : products.length === 0 ? <p className="py-2 text-sm">此主題還沒有其他商品，可建立商品後再設定同組限購。</p>
            : <div className="max-h-64 overflow-y-auto">
              {products.map((product) => <label key={product.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={value.exclusive_product_ids.includes(product.id)} onChange={(event) => {
                  let selected = event.target.checked ? [...value.exclusive_product_ids, product.id]
                    : value.exclusive_product_ids.filter((item) => item !== product.id);
                  if (product.id === productId && !event.target.checked) selected = [];
                  else if (productId && selected.length > 0 && !selected.includes(productId)) selected.push(productId);
                  onChange({ ...value, exclusive_product_ids: selected, exclusive_group: selected.length ? value.exclusive_group : null });
                }} />{product.name}{product.id === productId ? "（本商品）" : ""}
              </label>)}
            </div>}
      </fieldset>
      <p id={`${id}-group-help`} className="text-xs" style={{ color: "var(--text-secondary)" }}>
        可複選此主題的商品，包含系列中的商品；本商品會自動加入。儲存後所選商品合計每人限購一件，原有同組設定會依這次選擇調整。留空表示不設同組限制。
      </p>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={value.designated_only}
          onChange={(event) => onChange({ ...value, designated_only: event.target.checked })} />指定票種（僅名單可買，並鎖定同組其他商品）
      </label>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>工作票、表演票可勾選此設定，並填寫下方允許名單。商品上架後，名單立即鎖定同組其他票種；學生仍須自行下單。同一人請只指定一種票。</p>
    </div>
    <fieldset aria-describedby={`${id}-help`}>
      <legend className="text-sm font-medium">可購買年級</legend>
      <div className="flex flex-wrap gap-x-6">
        {([1, 2, 3] as const).map((grade) => <label key={grade} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={value.allowed_grades.includes(grade)} onChange={(event) => onChange({
            ...value, allowed_grades: event.target.checked
              ? [...value.allowed_grades, grade].sort() : value.allowed_grades.filter((item) => item !== grade),
          })} />高{["一", "二", "三"][grade - 1]}
        </label>)}
      </div>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>依系統目前班級判斷；例如高三優待票只勾選高三。</p>
    </fieldset>
    <div className="space-y-2">
      <label htmlFor={`${id}-permission`} className="block text-sm font-medium">必要權限</label>
      <select id={`${id}-permission`} className="input min-h-11 w-full" value=""
        disabled={disabled || permissionsState !== "ready"}
        onChange={(event) => {
          if (event.target.value) onChange({ ...value, required_permissions: [...value.required_permissions, event.target.value] });
        }}>
        <option value="">{permissionsState === "loading" ? "正在讀取權限…" : "選擇權限加入條件（可多選）"}</option>
        {permissions.filter((option) => !value.required_permissions.includes(option.code)).map((option) =>
          <option key={option.code} value={option.code}>{option.group}・{option.label}</option>)}
      </select>
      {permissionsState === "error" && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
        權限選項讀取失敗，原有條件已保留。<button type="button" className="min-h-11 underline" onClick={() => {
          setPermissionsState("loading"); setAttempt((current) => current + 1);
        }}>重新讀取</button>
      </p>}
      {value.required_permissions.length > 0 && <ul className="space-y-1">
        {value.required_permissions.map((code) => <li key={code} className="flex items-center justify-between gap-3 text-sm">
          <span>{permissions.find((option) => option.code === code)?.label ?? code}</span>
          <button type="button" className="btn btn-secondary min-h-11" aria-label={`移除權限 ${code}`}
            onClick={() => onChange({ ...value, required_permissions: value.required_permissions.filter((item) => item !== code) })}>移除</button>
        </li>)}
      </ul>}
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-allowed`} className="block text-sm font-medium">允許購買名單</label>
      <textarea id={`${id}-allowed`} rows={4} className="input w-full" value={allowedText}
        aria-describedby={`${id}-allowed-help`} placeholder="每行一個學號或 Email，也可用逗號分隔"
        onChange={(event) => { setAllowedText(event.target.value); onChange({ ...value, allowed_identifiers: identifiers(event.target.value) }); }} />
      <p id={`${id}-allowed-help`} className="text-xs" style={{ color: "var(--text-secondary)" }}>
        已輸入 {value.allowed_identifiers.length} 筆，最多 2,000 筆。填寫後只有名單中的學生能購買；學號可預先輸入。指定票種的名單留空時，暫無人可購買。
      </p>
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-blocked`} className="block text-sm font-medium">禁止購買名單</label>
      <textarea id={`${id}-blocked`} rows={4} className="input w-full" value={blockedText}
        aria-describedby={`${id}-blocked-help`} placeholder="例如：在一般票填入表演人員的學號或 Email"
        onChange={(event) => { setBlockedText(event.target.value); onChange({ ...value, blocked_identifiers: identifiers(event.target.value) }); }} />
      <p id={`${id}-blocked-help`} className="text-xs" style={{ color: "var(--text-secondary)" }}>
        已輸入 {value.blocked_identifiers.length} 筆，最多 2,000 筆。即使符合年級、權限或允許名單，仍無法購買此商品。
      </p>
    </div>
    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>儲存後立即限制新購與加購；已成立的訂單會保留，仍可減少數量或取消。名單僅商品管理者可查看。</p>
  </fieldset>;
}
