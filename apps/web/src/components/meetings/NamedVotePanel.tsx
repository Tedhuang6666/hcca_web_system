import type { MeetingAttendanceOut, MeetingOut, MeetingVoteOption } from "@/lib/types";

const CHOICE_LABEL: Record<string, string> = {
  approve: "同意",
  reject: "不同意",
  abstain: "棄權",
};

export default function NamedVotePanel({
  voters,
  vote,
  busy,
  onRecord,
  onClose,
}: {
  voters: MeetingAttendanceOut[];
  vote: NonNullable<MeetingOut["votes"][number]>;
  busy: boolean;
  onRecord: (record: MeetingAttendanceOut, choiceOrKey: string) => void;
  onClose: () => void;
}) {
  const custom = Boolean(vote.options && vote.options.length);
  const choices = custom
    ? (vote.options as MeetingVoteOption[]).map((o) => ({ key: o.key, label: o.label }))
    : [
        { key: "approve", label: CHOICE_LABEL.approve },
        { key: "reject", label: CHOICE_LABEL.reject },
        { key: "abstain", label: CHOICE_LABEL.abstain },
      ];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{vote.title}（逐人表決進行中）</p>
        <button
          disabled={busy}
          onClick={onClose}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm">
          結束表決
        </button>
      </div>
      <div className="grid gap-2">
        {voters.length === 0 && (
          <p className="text-sm text-[var(--muted)]">無可表決的出席委員。</p>
        )}
        {voters.map((record) => {
          const ballot = vote.ballots.find((b) => b.voter_id === record.user_id);
          const chosen = custom ? ballot?.option_key : ballot?.choice;
          return (
            <div key={record.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] p-2">
              <span className="text-sm">{record.user?.display_name ?? record.user_id}</span>
              <div className="flex gap-1">
                {choices.map((c) => (
                  <button
                    key={c.key}
                    disabled={busy}
                    onClick={() => onRecord(record, c.key)}
                    className={`rounded px-2 py-1 text-xs ${
                      chosen === c.key ? "bg-[var(--primary)] text-black" : "border border-[var(--border)]"
                    }`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
