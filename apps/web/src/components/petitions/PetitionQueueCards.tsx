import type { PetitionStatus } from "@/lib/types";

export type PetitionQueueKey = "all" | "pending" | "mine" | "active" | "needs_info" | "done";

export function queueStatus(queue: PetitionQueueKey): PetitionStatus | undefined {
  if (queue === "pending") return "submitted";
  if (queue === "active") return "in_progress";
  if (queue === "needs_info") return "needs_info";
  if (queue === "done") return "resolved";
  return undefined;
}

type PetitionQueueCard = {
  key: PetitionQueueKey;
  label: string;
  value: number;
};

export default function PetitionQueueCards({
  cards,
  queue,
  hasStatus,
  onSelect,
}: {
  cards: readonly PetitionQueueCard[];
  queue: PetitionQueueKey;
  hasStatus: boolean;
  onSelect: (key: PetitionQueueKey) => void;
}) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 lg:grid-cols-6"
      role="group"
      aria-label="案件佇列"
    >
      {cards.map((card) => (
        <button
          key={card.key}
          onClick={() => onSelect(card.key)}
          aria-pressed={queue === card.key && !hasStatus}
          className="card card-hover flex min-w-32 shrink-0 items-baseline justify-between gap-3 p-3 text-left sm:min-w-0"
          style={{
            borderColor: queue === card.key ? "var(--primary)" : "var(--border)",
            background: queue === card.key ? "var(--primary-dim)" : "var(--card-bg)",
          }}
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{card.label}</span>
          <span className="text-lg font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{card.value}</span>
        </button>
      ))}
    </div>
  );
}
