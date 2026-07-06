"use client";

import { useEffect, useRef, useState } from "react";
import Combobox, { type ComboboxOption } from "@/components/ui/Combobox";
import MultiCombobox from "@/components/ui/MultiCombobox";
import {
  ModeTabs,
  useOrgOptions,
  usePositionOptions,
  useUserSearch,
} from "@/components/ui/targeting";
import type { RecipientSelector } from "@/lib/types";

type Mode = "users" | "emails" | "positions" | "orgs" | "all";

const EMPTY: RecipientSelector = {
  user_ids: [],
  position_ids: [],
  org_ids: [],
  external_emails: [],
  include_all: false,
  include_school: false,
};

type AllScope = "school" | "everyone";

const MODES: { key: Mode; label: string }[] = [
  { key: "users", label: "個別使用者" },
  { key: "emails", label: "外部信箱" },
  { key: "positions", label: "依職位" },
  { key: "orgs", label: "依組織" },
  { key: "all", label: "全體成員" },
];

function selectorKey(sel: RecipientSelector): string {
  return JSON.stringify({
    user_ids: [...(sel.user_ids ?? [])].sort(),
    position_ids: [...(sel.position_ids ?? [])].sort(),
    org_ids: [...(sel.org_ids ?? [])].sort(),
    external_emails: [...(sel.external_emails ?? [])].sort(),
    include_all: sel.include_all,
    include_school: sel.include_school,
  });
}

interface RecipientPickerProps {
  value?: RecipientSelector;
  onChange: (sel: RecipientSelector) => void;
  disabled?: boolean;
}

export default function RecipientPicker({ value, onChange, disabled = false }: RecipientPickerProps) {
  const [mode, setMode] = useState<Mode>("users");
  const [allScope, setAllScope] = useState<AllScope>("school");
  const [selectedUsers, setSelectedUsers] = useState<ComboboxOption[]>([]);
  const [externalEmailsText, setExternalEmailsText] = useState("");
  const { results: userResults, search: searchUsers } = useUserSearch();
  const orgOptions = useOrgOptions();
  const [selectedOrgs, setSelectedOrgs] = useState<ComboboxOption[]>([]);
  const [posOrgId, setPosOrgId] = useState("");
  const posOptions = usePositionOptions(posOrgId);
  const [selectedPos, setSelectedPos] = useState<ComboboxOption[]>([]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueKey = value ? selectorKey(value) : "";

  useEffect(() => {
    if (!value) return;
    if (value.include_all) {
      setMode("all");
      setAllScope("everyone");
    } else if (value.include_school) {
      setMode("all");
      setAllScope("school");
    } else if ((value.external_emails ?? []).length > 0) {
      setMode("emails");
      setExternalEmailsText((value.external_emails ?? []).join("\n"));
    } else if ((value.position_ids ?? []).length > 0) {
      setMode("positions");
      setSelectedPos((value.position_ids ?? []).map((id) => ({ value: id, label: id })));
    } else if ((value.org_ids ?? []).length > 0) {
      setMode("orgs");
      setSelectedOrgs((value.org_ids ?? []).map((id) => ({ value: id, label: id })));
    } else if ((value.user_ids ?? []).length > 0) {
      setMode("users");
      setSelectedUsers((value.user_ids ?? []).map((id) => ({ value: id, label: id })));
    } else {
      setSelectedUsers([]);
      setExternalEmailsText("");
      setSelectedPos([]);
      setSelectedOrgs([]);
      setMode("users");
    }
  }, [value, valueKey]);

  // 任一模式/選擇變動 → 發出對應的 RecipientSelector
  useEffect(() => {
    let sel: RecipientSelector;
    if (mode === "users") {
      sel = { ...EMPTY, user_ids: selectedUsers.map((u) => u.value) };
    } else if (mode === "emails") {
      sel = {
        ...EMPTY,
        external_emails: externalEmailsText
          .split(/[\s,;]+/)
          .map((email) => email.trim())
          .filter(Boolean),
      };
    } else if (mode === "positions") {
      sel = { ...EMPTY, position_ids: selectedPos.map((p) => p.value) };
    } else if (mode === "orgs") {
      sel = { ...EMPTY, org_ids: selectedOrgs.map((o) => o.value) };
    } else if (allScope === "everyone") {
      sel = { ...EMPTY, include_all: true };
    } else {
      sel = { ...EMPTY, include_school: true };
    }
    if (valueKey && selectorKey(sel) === valueKey) return;
    onChangeRef.current(sel);
  }, [mode, allScope, selectedUsers, externalEmailsText, selectedPos, selectedOrgs, valueKey]);

  return (
    <div className="space-y-3">
      <ModeTabs modes={MODES} value={mode} onChange={setMode} disabled={disabled} />

      {mode === "users" && (
        <MultiCombobox
          selected={selectedUsers}
          onChange={setSelectedUsers}
          options={userResults}
          onSearch={searchUsers}
          disabled={disabled}
          placeholder="輸入姓名或 Email 搜尋（至少 2 字）"
          emptyText="找不到使用者"
        />
      )}

      {mode === "emails" && (
        <textarea
          className="input min-h-28"
          value={externalEmailsText}
          onChange={(e) => setExternalEmailsText(e.target.value)}
          disabled={disabled}
          placeholder={
            "輸入完整 Email，可用換行、逗號或分號分隔\nexample@gmail.com\npartner@example.org"
          }
        />
      )}

      {mode === "positions" && (
        <div className="space-y-2">
          <Combobox
            value={posOrgId}
            onChange={(v) => {
              setPosOrgId(v);
              setSelectedPos([]);
            }}
            options={orgOptions}
            placeholder="先選擇組織"
            clearable
            disabled={disabled}
            ariaLabel="選擇職位所屬組織"
          />
          {posOrgId && (
            <MultiCombobox
              selected={selectedPos}
              onChange={setSelectedPos}
              options={posOptions}
              disabled={disabled}
              placeholder="選擇職位（可多選）"
              emptyText="此組織尚無職位"
            />
          )}
        </div>
      )}

      {mode === "orgs" && (
        <MultiCombobox
          selected={selectedOrgs}
          onChange={setSelectedOrgs}
          options={orgOptions}
          disabled={disabled}
          placeholder="選擇機關（可多選）"
          emptyText="找不到組織"
        />
      )}

      {mode === "all" && (
        <div className="space-y-2">
          <ModeTabs
            modes={[
              { key: "school" as AllScope, label: "全部竹中使用者" },
              { key: "everyone" as AllScope, label: "全部使用者（含校外）" },
            ]}
            value={allScope}
            onChange={setAllScope}
            disabled={disabled}
          />
          <div
            className="rounded-lg px-3 py-3 text-xs"
            style={{
              background: "var(--warning-dim, rgba(245,158,11,0.12))",
              border: "1px solid var(--warning-border)",
              color: "var(--warning)",
            }}
          >
            {allScope === "school"
              ? "⚠ 將寄送給全校（校內信箱）所有啟用中的使用者，請確認內容無誤後再送出。"
              : "⚠ 將寄送給平台上所有啟用中的使用者，包含校外與管理員帳號，請謹慎使用。"}
          </div>
        </div>
      )}
    </div>
  );
}
