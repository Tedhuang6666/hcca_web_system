"use client";
import type { ComboboxOption } from "@/components/ui/Combobox";
import MultiCombobox from "@/components/ui/MultiCombobox";
import { useUserSearch } from "@/components/ui/targeting";
import type { UserSummary } from "@/lib/types";

/** 使用者開放式選單：搜尋並挑選特定使用者（共用 useUserSearch + MultiCombobox）。 */
export default function UserPicker({
  value,
  onChange,
}: {
  value: UserSummary[];
  onChange: (users: UserSummary[]) => void;
}) {
  const { results, search } = useUserSearch();

  const selected: ComboboxOption[] = value.map((u) => ({
    value: u.id,
    label: u.display_name,
    description: u.email,
  }));

  const handleChange = (opts: ComboboxOption[]) => {
    onChange(
      opts.map((o) => ({ id: o.value, display_name: o.label, email: o.description ?? "" })),
    );
  };

  return (
    <MultiCombobox
      selected={selected}
      onChange={handleChange}
      options={results}
      onSearch={search}
      placeholder="輸入姓名或信箱搜尋使用者…（至少 2 字）"
      emptyText="找不到使用者"
    />
  );
}
