"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Combobox from "@/components/ui/Combobox";
import MultiCombobox from "@/components/ui/MultiCombobox";
import Modal from "@/components/ui/Modal";
import { adminApi, ApiError, apiErrorMessage } from "@/lib/api";
import type { AccountMergeConflict, AdminUserDetail } from "@/lib/types";

type MergeUser = Pick<AdminUserDetail,
  "id" | "display_name" | "student_id" | "email" | "linked_emails" | "is_active"
>;

const buttonClass = "min-h-11 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]";
const neutralStyle = { border: "1px solid var(--border)", color: "var(--text-primary)" };
const warningStyle = { background: "var(--warning-dim)", color: "var(--warning)" };

export function AccountMergeSection({ user, users, onChanged }: {
  user: MergeUser;
  users: MergeUser[];
  onChanged: () => Promise<void>;
}) {
  const [knownUsers, setKnownUsers] = useState<MergeUser[]>([user, ...users]);
  const [search, setSearch] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    setKnownUsers((current) => [...new Map([...current, ...users, user].map((item) => [item.id, item])).values()]);
  }, [user, users]);
  useEffect(() => {
    if (!search.trim()) { setSearchBusy(false); setSearchError(""); return; }
    let cancelled = false;
    setSearchBusy(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      void adminApi.listUsers({ keyword: search.trim(), active_only: true, limit: 200 })
        .then((rows) => {
          if (!cancelled) setKnownUsers((current) => [...new Map([...current, ...rows].map((item) => [item.id, item])).values()]);
        })
        .catch(() => { if (!cancelled) setSearchError("搜尋帳戶失敗，請重新輸入關鍵字重試。"); })
        .finally(() => { if (!cancelled) setSearchBusy(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search]);
  const [primaryId, setPrimaryId] = useState(user.id);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<AccountMergeConflict[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"closed" | "choices" | "confirm">("closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const accounts = [...new Map(knownUsers.map((candidate) => [candidate.id, candidate])).values()].filter((candidate) => candidate.is_active);
  const primary = accounts.find((candidate) => candidate.id === primaryId);
  const sources = accounts.filter((candidate) => sourceIds.includes(candidate.id));
  const options = accounts.map((candidate) => ({
    value: candidate.id,
    label: `${candidate.display_name} · ${candidate.student_id ?? candidate.email}`,
    description: candidate.student_id ? candidate.email : undefined,
    keywords: candidate.linked_emails.join(" "),
  }));
  const sourceOptions = options.filter((option) => option.value !== primaryId);
  const allChosen = conflicts.every((conflict) => conflict.resolvable
    && conflict.records.some((record) => record.id === choices[conflict.key]));

  const showPreview = (next: AccountMergeConflict[], preserveChoices = false) => {
    setConflicts(next);
    setChoices((previous) => Object.fromEntries(next.flatMap((conflict) => {
      const previousId = preserveChoices && previous[conflict.key];
      return previousId && conflict.records.some((record) => record.id === previousId)
        ? [[conflict.key, previousId]] : [];
    })));
    setPhase(next.length ? "choices" : "confirm");
  };

  const preview = async () => {
    if (pending.current || !primary || !sources.length) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await adminApi.previewUserMerge(primaryId, sourceIds);
      showPreview(result.conflicts);
    } catch (cause) {
      setError(apiErrorMessage(cause, "無法檢查合併資料，請重試。"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const merge = async () => {
    if (pending.current || !primary || !sources.length || !allChosen) return;
    pending.current = true;
    setBusy(true);
    setError("");
    let merged = false;
    try {
      await adminApi.mergeUserAccounts(primaryId, sourceIds, choices);
      merged = true;
      setPhase("closed");
      setKnownUsers((current) => current.filter((candidate) => !sourceIds.includes(candidate.id)));
      setSourceIds([]);
      setConflicts([]);
      setChoices({});
      toast.success("帳戶已合併，歷史資料已歸戶");
      await onChanged();
    } catch (cause) {
      // 預覽後新增的衝突也要回到選擇流程，不能只顯示一則錯誤。
      if (!merged && cause instanceof ApiError && cause.status === 409) {
        try {
          const result = await adminApi.previewUserMerge(primaryId, sourceIds);
          showPreview(result.conflicts, true);
          setError(result.conflicts.length
            ? "合併資料已變更，請確認以下選擇後再繼續。"
            : apiErrorMessage(cause, "合併未完成，請重新檢查。"));
        } catch {
          setError("無法重新取得衝突資料，請關閉視窗後重新檢查。");
          setPhase("closed");
        }
      } else {
        setError(merged ? "合併已完成，但清單更新失敗，請重新整理頁面。"
          : apiErrorMessage(cause, "合併失敗，請重試。"));
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const close = () => { if (!pending.current) { setPhase("closed"); setError(""); } };

  return (
    <section className="space-y-4 rounded-xl p-4 [&_p]:break-words" style={{ border: "1px solid var(--border)" }}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>帳戶合併與歸戶</h3>
        <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
          搜尋姓名、學號或 Email 選擇帳戶。主要帳戶保留帳號資料，其他帳戶的登入身分與歷史紀錄會併入。
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>主要帳戶（合併後保留）</p>
        <Combobox
          value={primaryId}
          options={options}
          onSearch={setSearch}
          ariaLabel="主要帳戶（合併後保留）"
          placeholder="搜尋姓名、學號或 Email"
          disabled={busy}
          inputStyle={{ minHeight: 44, fontSize: 16 }}
          onChange={(next) => {
            setPrimaryId(next);
            setSourceIds((current) => current.filter((id) => id !== next));
            setError("");
          }}
        />
      </div>
      <div className="space-y-2 [&_input]:min-h-11 [&_input]:text-base">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>次要帳戶（可選多個）</p>
        <MultiCombobox
          selected={sourceOptions.filter((option) => sourceIds.includes(option.value))}
          options={sourceOptions.filter((option) => `${option.label} ${option.description ?? ""} ${option.keywords}`.toLowerCase().includes(search.trim().toLowerCase()))}
          onSearch={setSearch}
          ariaLabel="次要帳戶（可選多個）"
          placeholder="搜尋並加入要合併的帳戶"
          disabled={busy}
          emptyText="找不到其他帳戶，請換個關鍵字搜尋"
          onChange={(selected) => { setSourceIds(selected.map((option) => option.value)); setError(""); }}
        />
      </div>
      {searchBusy && <p role="status" className="text-sm" style={{ color: "var(--text-secondary)" }}>搜尋帳戶中…</p>}
      {searchError && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{searchError}</p>}
      <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
        系統會自動整理重複關聯與內部識別資料；只有需要取捨的資料才會請你選擇。每次最多合併 20 個帳戶。
      </p>
      {sourceIds.length > 20 && <p role="alert" style={{ color: "var(--danger)" }}>請將次要帳戶減少至 20 個以內。</p>}
      {error && phase === "closed" && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      <button type="button" className={buttonClass} style={warningStyle}
        disabled={busy || !primary || !sources.length || sourceIds.length > 20} onClick={preview}>
        {busy ? "檢查資料中…" : `檢查衝突並合併${sources.length ? `（${sources.length}）` : ""}`}
      </button>
      {phase !== "closed" && (
        <Modal title={phase === "choices" ? "選擇要保留的資料" : "確認合併帳戶"} onClose={close} size="2xl"
          footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass} style={neutralStyle} disabled={busy} onClick={close}>取消</button>
            {phase === "confirm" && conflicts.length > 0 && (
              <button type="button" className={buttonClass} style={neutralStyle} disabled={busy} onClick={() => setPhase("choices")}>返回修改選擇</button>
            )}
            <button type="button" className={buttonClass} style={warningStyle}
              disabled={busy || !allChosen} onClick={phase === "choices" ? () => { setError(""); setPhase("confirm"); } : merge}>
              {busy ? "合併中…" : phase === "choices" ? "確認選擇並繼續" : "確認合併帳戶"}
            </button>
          </div>}>
          <div className="space-y-4 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
            {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
            {phase === "choices" ? <>
              <p>以下資料合併後只能保留一筆。請逐項選擇，其餘獨立紀錄與可自動整理的資料會一併歸戶。</p>
              {conflicts.map((conflict) => (
                <fieldset key={conflict.key} className="space-y-2 rounded-lg p-3" style={neutralStyle}>
                  <legend className="px-1 font-semibold">{conflict.title}</legend>
                  <p>{conflict.message}</p>
                  {conflict.resolvable ? conflict.records.map((record) => (
                    <label key={record.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg p-3"
                      style={{ background: choices[conflict.key] === record.id ? "var(--primary-dim)" : "var(--bg-elevated)" }}>
                      <input type="radio" name={conflict.key} value={record.id}
                        checked={choices[conflict.key] === record.id}
                        onChange={() => setChoices((current) => ({ ...current, [conflict.key]: record.id }))}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]" />
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{record.side === "target" ? "主要帳戶" : "次要帳戶"}：{record.owner_name}</span>
                        <span className="mt-1 block">{record.label}</span>
                      </span>
                    </label>
                  )) : <p style={{ color: "var(--warning)" }}>請先處理上述資料後再重新檢查。</p>}
                </fieldset>
              ))}
            </> : <>
              <p>將以下帳戶合併至 <strong style={{ color: "var(--text-primary)" }}>{primary?.display_name} · {primary?.email}</strong>：</p>
              <ul className="list-disc space-y-1 pl-5">{sources.map((source) => <li key={source.id} className="break-words">{source.display_name} · {source.email}</li>)}</ul>
              <p>主要帳戶的名稱、學號、Email 與偏好設定會保留。次要帳戶會停用，登入身分及歷史資料會歸戶；此操作無法復原。</p>
              {conflicts.length > 0 && <div className="space-y-2">
                <p className="font-medium">你選擇保留的資料</p>
                {conflicts.map((conflict) => {
                  const record = conflict.records.find((item) => item.id === choices[conflict.key]);
                  return <p key={conflict.key}>{conflict.title}：{record?.owner_name} · {record?.label}</p>;
                })}
              </div>}
            </>}
          </div>
        </Modal>
      )}
    </section>
  );
}
