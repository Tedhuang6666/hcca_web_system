import type { PetitionCaseOut } from "@/lib/types";
import { PetitionStatusBadge } from "@/components/ui/StatusBadge";

export function PetitionConfidentialBlocked({ item }: { item: PetitionCaseOut }) {
  return (
    <section
      className="rounded-lg p-5 space-y-4"
      role="status"
      aria-live="polite"
      style={{ background: "var(--warning-dim)", border: "1px solid var(--warning-border)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>案件 #{item.case_number}</p>
          <h2 className="text-lg font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
            此案件已被設為密件
          </h2>
        </div>
        <PetitionStatusBadge status={item.status} />
      </div>
      <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
        你可以確認此案件存在，但目前沒有查看案件內容的權限。
      </p>
      <div className="rounded-lg p-4 space-y-1" style={{ background: "var(--bg-surface)", border: "1px solid var(--warning-border)" }}>
        <p className="text-xs font-medium" style={{ color: "var(--warning)" }}>設為密件的原因</p>
        <p className="text-sm whitespace-pre-wrap leading-6" style={{ color: "var(--text-primary)" }}>
          {item.confidential_reason || "未提供密件原因。"}
        </p>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        完整內容僅案件擁有者與目前承辦人可查看。
      </p>
    </section>
  );
}
