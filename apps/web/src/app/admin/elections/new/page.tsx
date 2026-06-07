"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Loader2, X } from "lucide-react";
import { electionsApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";

type MemberForm = { position: string; name: string; photo_url: string | null };
type CandidateForm = {
  number: number;
  color: string;
  members: MemberForm[];
};

function createCandidate(number: number, color: string): CandidateForm {
  return {
    number,
    color,
    members: [
      { position: "主席", name: "", photo_url: null },
      { position: "副主席", name: "", photo_url: null },
    ],
  };
}

export default function NewElectionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [candidates, setCandidates] = useState([
    createCandidate(1, "#2563eb"),
    createCandidate(2, "#dc2626"),
  ]);
  const [boxes, setBoxes] = useState([{ name: "", expected_total_votes: "" }]);
  const [seats, setSeats] = useState("1");
  const [eligibleVoters, setEligibleVoters] = useState("");
  const [turnoutPct, setTurnoutPct] = useState("");
  const [thresholdPct, setThresholdPct] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  function patchMember(ci: number, mi: number, patch: Partial<MemberForm>) {
    setCandidates((prev) =>
      prev.map((item, i) =>
        i === ci
          ? { ...item, members: item.members.map((m, j) => (j === mi ? { ...m, ...patch } : m)) }
          : item,
      ),
    );
  }

  async function uploadPhoto(ci: number, mi: number, file: File) {
    const key = `${ci}-${mi}`;
    setUploading(key);
    try {
      const { url } = await electionsApi.uploadImage(file);
      patchMember(ci, mi, { photo_url: url });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "照片上傳失敗");
    } finally {
      setUploading(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (turnoutPct && !eligibleVoters) {
      toast.error("設定總投票率門檻時，請先填寫在校總人數");
      return;
    }
    setSaving(true);
    try {
      const election = await electionsApi.create({
        title,
        description: description || undefined,
        seats: Math.max(1, Number(seats) || 1),
        eligible_voter_count: eligibleVoters ? Number(eligibleVoters) : null,
        turnout_threshold_pct: turnoutPct ? Number(turnoutPct) : null,
        vote_threshold_pct: thresholdPct ? Number(thresholdPct) : null,
        candidates: candidates.map((item, index) => ({
          name: item.members
            .map((member) => `${member.position.trim()} ${member.name.trim()}`)
            .join("、"),
          number: item.number,
          color: item.color,
          sort_order: index,
          members: item.members.map((member, memberIndex) => ({
            position: member.position,
            name: member.name,
            photo_url: member.photo_url,
            sort_order: memberIndex,
          })),
        })),
        ballot_boxes: boxes.map((item, index) => ({
          name: item.name,
          expected_total_votes: item.expected_total_votes
            ? Number(item.expected_total_votes)
            : null,
          sort_order: index,
        })),
      });
      toast.success("選舉已建立");
      router.push(`/admin/elections/${election.id}/count`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">建立選舉</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          開始開票後，候選人、候選組合與票匭結構將固定
        </p>
      </div>
      <section className="card p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">選舉名稱</span>
          <input className="input w-full mt-2" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">說明</span>
          <textarea className="input w-full mt-2 min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </section>
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold">當選規則</h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            依序判定：①（選填）總投票率須達門檻才產生當選者 → ②（選填）候選人須達得票率門檻 → ③ 依票數取前「應選名額」名為當選
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">應選名額（選幾組／人）</span>
            <input type="number" min={1} className="input w-full mt-2" value={seats} onChange={(e) => setSeats(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">在校總人數（投票率分母，選填）</span>
            <input type="number" min={0} className="input w-full mt-2" placeholder="例如 1200" value={eligibleVoters} onChange={(e) => setEligibleVoters(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">總投票率門檻 %（不含廢票，選填）</span>
            <input type="number" min={0} max={100} step="0.1" className="input w-full mt-2" placeholder="例如 50，需先填在校總人數" value={turnoutPct} onChange={(e) => setTurnoutPct(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">候選人得票率門檻 %（佔有效票，選填）</span>
            <input type="number" min={0} max={100} step="0.1" className="input w-full mt-2" placeholder="例如 25" value={thresholdPct} onChange={(e) => setThresholdPct(e.target.value)} />
          </label>
        </div>
      </section>
      <section className="card p-6 space-y-4">
        <div className="flex justify-between">
          <div>
            <h2 className="font-semibold">候選人／候選組合／選項</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              每個號次可加入一位或多位成員，分別填寫參選職位與姓名
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setCandidates([...candidates, createCandidate(candidates.length + 1, "#7c3aed")])}>
            新增候選人／組合
          </button>
        </div>
        {candidates.map((candidate, index) => (
          <div key={index} className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)" }}>
            <div className="grid grid-cols-[80px_70px_1fr] items-center gap-3">
              <input type="number" min={1} className="input" aria-label="候選號次" value={candidate.number} onChange={(e) => setCandidates(candidates.map((item, i) => i === index ? { ...item, number: Number(e.target.value) } : item))} />
              <input type="color" className="input h-10 p-1" aria-label="候選識別色" value={candidate.color} onChange={(e) => setCandidates(candidates.map((item, i) => i === index ? { ...item, color: e.target.value } : item))} />
              <strong>{candidate.number} 號候選人／組合</strong>
            </div>
            <div className="space-y-2">
              {candidate.members.map((member, memberIndex) => {
                const uploadKey = `${index}-${memberIndex}`;
                const isUploading = uploading === uploadKey;
                return (
                <div key={memberIndex} className="grid grid-cols-[auto_minmax(110px,0.7fr)_minmax(150px,1fr)_auto] items-center gap-2">
                  <label
                    className="relative grid h-14 w-14 cursor-pointer place-items-center overflow-hidden rounded-full border text-center"
                    style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
                    title="上傳照片"
                  >
                    {member.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={uploadUrl(member.photo_url)}
                        alt={member.name || "候選人照片"}
                        className="h-full w-full object-cover"
                      />
                    ) : isUploading ? (
                      <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                    ) : (
                      <ImagePlus size={18} style={{ color: "var(--text-muted)" }} />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={isUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadPhoto(index, memberIndex, file);
                        event.target.value = "";
                      }}
                    />
                    {member.photo_url && (
                      <button
                        type="button"
                        aria-label="移除照片"
                        className="absolute right-0 top-0 grid h-5 w-5 place-items-center rounded-full text-white"
                        style={{ background: "var(--danger)" }}
                        onClick={(event) => {
                          event.preventDefault();
                          patchMember(index, memberIndex, { photo_url: null });
                        }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </label>
                  <input
                    required
                    className="input"
                    placeholder="職位，例如主席"
                    value={member.position}
                    onChange={(event) => patchMember(index, memberIndex, { position: event.target.value })}
                  />
                  <input
                    required
                    className="input"
                    placeholder="姓名"
                    value={member.name}
                    onChange={(event) => patchMember(index, memberIndex, { name: event.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={candidate.members.length === 1}
                    onClick={() => setCandidates(candidates.map((item, i) => i === index ? {
                      ...item,
                      members: item.members.filter((_, j) => j !== memberIndex),
                    } : item))}
                  >
                    移除
                  </button>
                </div>
                );
              })}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCandidates(candidates.map((item, i) => i === index ? {
                ...item,
                members: [...item.members, { position: "", name: "", photo_url: null }],
              } : item))}
            >
              新增組合成員
            </button>
          </div>
        ))}
      </section>
      <section className="card p-6 space-y-4">
        <div className="flex justify-between">
          <h2 className="font-semibold">票匭</h2>
          <button type="button" className="btn btn-secondary" onClick={() => setBoxes([...boxes, { name: "", expected_total_votes: "" }])}>
            新增票匭
          </button>
        </div>
        {boxes.map((box, index) => (
          <div key={index} className="grid grid-cols-[1fr_180px] gap-3">
            <input required className="input" placeholder="例如：一年級票匭" value={box.name} onChange={(e) => setBoxes(boxes.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
            <input type="number" min={0} className="input" placeholder="預期票數（選填）" value={box.expected_total_votes} onChange={(e) => setBoxes(boxes.map((item, i) => i === index ? { ...item, expected_total_votes: e.target.value } : item))} />
          </div>
        ))}
      </section>
      <button disabled={saving} className="btn btn-primary w-full">
        {saving ? "建立中…" : "建立並進入控制台"}
      </button>
    </form>
  );
}
