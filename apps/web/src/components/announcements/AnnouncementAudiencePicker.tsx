"use client";

import { useEffect, useRef, useState } from "react";
import type { ComboboxOption } from "@/components/ui/Combobox";
import MultiCombobox from "@/components/ui/MultiCombobox";
import { ModeTabs, toOptions, useOrgOptions, useUserSearch } from "@/components/ui/targeting";
import type { AnnouncementAudience, AnnouncementAudienceRef } from "@/lib/types";

export interface AudienceValue {
  audience_type: AnnouncementAudience;
  audience_org_ids: string[];
  audience_user_ids: string[];
}

interface AnnouncementAudiencePickerProps {
  /** 初始對象類型（編輯頁帶入；新增頁預設 all） */
  initialType?: AnnouncementAudience;
  /** 初始已選組織（編輯頁帶入，用於顯示名稱） */
  initialOrgs?: AnnouncementAudienceRef[];
  /** 初始已選成員（編輯頁帶入，用於顯示名稱） */
  initialMembers?: AnnouncementAudienceRef[];
  onChange: (value: AudienceValue) => void;
  disabled?: boolean;
}

const MODES: { key: AnnouncementAudience; label: string; desc: string }[] = [
  { key: "all", label: "全體", desc: "任何人皆可檢視，包含未登入訪客。" },
  { key: "school", label: "全體竹中生", desc: "僅限校內 Google 帳號檢視。" },
  { key: "orgs", label: "特定組織", desc: "僅限所選組織的現任成員檢視。" },
  { key: "members", label: "特定成員", desc: "僅限所選的使用者本人檢視。" },
];

/**
 * 公告對象選擇器。對象決定公告的可見範圍：
 * orgs / members 模式使用開放式（可搜尋）選單複選目標。
 */
export default function AnnouncementAudiencePicker({
  initialType = "all",
  initialOrgs,
  initialMembers,
  onChange,
  disabled = false,
}: AnnouncementAudiencePickerProps) {
  const [type, setType] = useState<AnnouncementAudience>(initialType);
  const orgOptions = useOrgOptions();
  const [selectedOrgs, setSelectedOrgs] = useState<ComboboxOption[]>(() => toOptions(initialOrgs));
  const { results: memberResults, search: searchMembers } = useUserSearch();
  const [selectedMembers, setSelectedMembers] = useState<ComboboxOption[]>(() =>
    toOptions(initialMembers),
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 任一選擇變動 → 回傳對應的對象設定
  useEffect(() => {
    onChangeRef.current({
      audience_type: type,
      audience_org_ids: type === "orgs" ? selectedOrgs.map((o) => o.value) : [],
      audience_user_ids: type === "members" ? selectedMembers.map((m) => m.value) : [],
    });
  }, [type, selectedOrgs, selectedMembers]);

  const activeMode = MODES.find((m) => m.key === type);

  return (
    <section className="card p-4 space-y-3">
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          公告對象
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          對象決定誰看得到這則公告。
        </p>
      </div>

      <ModeTabs modes={MODES} value={type} onChange={setType} disabled={disabled} />

      {activeMode && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {activeMode.desc}
        </p>
      )}

      {type === "orgs" && (
        <MultiCombobox
          selected={selectedOrgs}
          onChange={setSelectedOrgs}
          options={orgOptions}
          disabled={disabled}
          placeholder="搜尋並選擇組織（可多選）"
          emptyText="找不到組織"
        />
      )}

      {type === "members" && (
        <MultiCombobox
          selected={selectedMembers}
          onChange={setSelectedMembers}
          options={memberResults}
          onSearch={searchMembers}
          disabled={disabled}
          placeholder="輸入姓名或 Email 搜尋（至少 2 字）"
          emptyText="找不到使用者"
        />
      )}
    </section>
  );
}
