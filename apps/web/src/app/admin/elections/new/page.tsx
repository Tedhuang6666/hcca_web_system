"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { electionsApi } from "@/lib/api";

export default function NewElectionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [candidates, setCandidates] = useState([
    { name: "", number: 1, color: "#2563eb" },
    { name: "", number: 2, color: "#dc2626" },
  ]);
  const [boxes, setBoxes] = useState([{ name: "", expected_total_votes: "" }]);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const election = await electionsApi.create({
        title,
        description: description || undefined,
        candidates: candidates.map((item, index) => ({ ...item, sort_order: index })),
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
          開始開票後，候選人／組合與票匭結構將固定
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
        <div className="flex justify-between">
          <div>
            <h2 className="font-semibold">候選人／候選組合／選項</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              聯合參選時，可在同一欄填寫完整組合與職位
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setCandidates([...candidates, { name: "", number: candidates.length + 1, color: "#7c3aed" }])}>
            新增候選人／組合
          </button>
        </div>
        {candidates.map((candidate, index) => (
          <div key={index} className="grid grid-cols-[80px_1fr_70px] gap-3">
            <input type="number" min={1} className="input" value={candidate.number} onChange={(e) => setCandidates(candidates.map((item, i) => i === index ? { ...item, number: Number(e.target.value) } : item))} />
            <input required className="input" placeholder="例：王小明（主席）＋李小華（副主席）" value={candidate.name} onChange={(e) => setCandidates(candidates.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
            <input type="color" className="input h-10 p-1" value={candidate.color} onChange={(e) => setCandidates(candidates.map((item, i) => i === index ? { ...item, color: e.target.value } : item))} />
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
