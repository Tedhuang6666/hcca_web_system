"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Copy, ExternalLink, Gauge, Lock, Pause, Play, Plus, RefreshCw, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import { apiErrorMessage, rafflesApi, type RaffleCreateInput } from "@/lib/api";
import type { RaffleAdminOut, RaffleStatus } from "@/lib/types";

import styles from "./raffle-admin.module.css";

type PrizeDraft = RaffleCreateInput["prizes"][number];

const starterPrizes: PrizeDraft[] = [
  { tier: "A", name: "水壺", quantity: 2, sort_order: 0 },
  { tier: "A", name: "帽踢", quantity: 2, sort_order: 1 },
  { tier: "B", name: "麻袋", quantity: 5, sort_order: 2 },
  { tier: "B", name: "帆布袋", quantity: 5, sort_order: 3 },
  { tier: "C", name: "金屬吊牌", quantity: 10, sort_order: 4 },
  { tier: "D", name: "資料夾或徽章", quantity: null, sort_order: 5 },
];

const statusLabel: Record<RaffleStatus, string> = { draft: "草稿", open: "進行中", paused: "暫停", closed: "已結束" };

export default function RaffleAdminClient() {
  const { isAdmin } = usePermissions();
  const [events, setEvents] = useState<RaffleAdminOut[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdCodes, setCreatedCodes] = useState<Record<string, string>>({});
  const [form, setForm] = useState<RaffleCreateInput>({
    event_code: "WELCOME26",
    title: "迎新現場抽獎",
    description: "每位參加者一次機會，好獎分段釋出。",
    access_code: "2626",
    prizes: starterPrizes,
  });

  const selected = events.find((event) => event.id === selectedId) ?? events[0] ?? null;

  const load = useCallback(async () => {
    try {
      const rows = await rafflesApi.list();
      setEvents(rows);
      setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "無法讀取抽獎活動"));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const createEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.event_code.trim() || !form.title.trim() || !form.access_code.trim()) {
      toast.error("請完成活動碼、標題與驗證碼");
      return;
    }
    setBusy(true);
    try {
      const created = await rafflesApi.create({ ...form, event_code: form.event_code.trim(), title: form.title.trim() });
      setCreatedCodes((current) => ({ ...current, [created.id]: form.access_code }));
      toast.success("抽獎活動已建立，請確認獎品後再開放");
      await load();
      setSelectedId(created.id);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "建立活動失敗"));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: RaffleStatus, reserve_released?: boolean) => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await rafflesApi.update(selected.id, { status, reserve_released });
      setEvents((current) => current.map((row) => row.id === updated.id ? updated : row));
      toast.success(status === "open" ? "抽獎台已開放" : status === "paused" ? "抽獎台已暫停" : status === "closed" ? "活動已結束" : "已更新活動");
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "更新活動失敗"));
    } finally {
      setBusy(false);
    }
  };

  const releaseReserve = () => {
    if (!selected) return;
    void changeStatus(selected.status, true);
  };

  const copy = async (text: string, message: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  };

  const finiteRemaining = selected?.prizes.reduce((sum, prize) => sum + (prize.remaining_quantity ?? 0), 0) ?? 0;

  if (!isAdmin) {
    return <main className={styles.denied}><Lock size={30} /><h1>需要管理員權限</h1><p>抽獎活動設定僅開放給管理員。</p></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><div className={styles.kicker}><Sparkles size={14} /> 現場工具</div><h1>抽獎控制台</h1><p>先設定獎品，再交給現場平板。庫存由後端鎖定，不怕多台同時抽。</p></div>
        <button className={styles.ghostButton} type="button" onClick={() => void load()}><RefreshCw size={15} /> 重新整理</button>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}><span>活動清單</span><span className={styles.count}>{events.length}</span></div>
          {events.length === 0 ? <div className={styles.emptyList}><Gauge size={20} /><p>還沒有活動</p><span>右側建立第一場抽獎</span></div> : events.map((event) => (
            <button key={event.id} type="button" className={`${styles.eventItem} ${selected?.id === event.id ? styles.eventItemActive : ""}`} onClick={() => setSelectedId(event.id)}>
              <span className={`${styles.statusDot} ${styles[`status_${event.status}`]}`} />
              <span className={styles.eventItemCopy}><strong>{event.title}</strong><small>{event.event_code} · {statusLabel[event.status]}</small></span><ChevronRight size={15} />
            </button>
          ))}
          <div className={styles.sideNote}><ShieldCheck size={15} /><span>抽獎結果會留存紀錄，平板只保留匿名 session。</span></div>
        </aside>

        <section className={styles.content}>
          {!selected ? <CreateForm form={form} setForm={setForm} onSubmit={createEvent} busy={busy} /> : (
            <>
              <div className={styles.controlHead}><div><span className={`${styles.statusBadge} ${styles[`badge_${selected.status}`]}`}>{statusLabel[selected.status]}</span><h2>{selected.title}</h2><p>{selected.description || "尚未填寫活動說明"}</p></div><div className={styles.headActions}>
                {selected.status === "draft" && <button className={styles.primarySmall} type="button" disabled={busy} onClick={() => void changeStatus("open")}><Play size={14} /> 開放抽獎</button>}
                {selected.status === "open" && <button className={styles.warningSmall} type="button" disabled={busy} onClick={() => void changeStatus("paused")}><Pause size={14} /> 暫停</button>}
                {selected.status === "paused" && <button className={styles.primarySmall} type="button" disabled={busy} onClick={() => void changeStatus("open")}><Play size={14} /> 繼續抽獎</button>}
                {selected.status !== "closed" && <button className={styles.closeSmall} type="button" disabled={busy} onClick={() => void changeStatus("closed")}><X size={14} /> 結束</button>}
              </div></div>

              <div className={styles.metrics}><Metric label="已抽出" value={String(selected.draw_count)} note="人" accent="orange" /><Metric label="有限獎剩餘" value={String(finiteRemaining)} note="份" accent="yellow" /><Metric label="節奏" value={selected.reserve_released ? "尾聲" : "保留中"} note={selected.reserve_released ? "全獎池開放" : "每 3 人釋出 1 份"} accent="green" /></div>

              <div className={styles.gridTwo}>
                <section className={styles.panel}><div className={styles.panelTitle}><div><span>獎品庫存</span><small>後端即時狀態</small></div>{!selected.reserve_released && selected.status !== "closed" && <button className={styles.outlineButton} type="button" onClick={releaseReserve}><Send size={14} /> 釋放尾聲獎</button>}</div><div className={styles.prizeList}>{selected.prizes.map((prize) => <div className={styles.prizeRow} key={prize.id}><span className={`${styles.tier} ${styles[`tier_${prize.tier}`]}`}>{prize.tier}</span><strong>{prize.name}</strong><span className={styles.stock}>{prize.remaining_quantity === null ? "∞" : `${prize.remaining_quantity} / ${prize.total_quantity}`}</span></div>)}</div><p className={styles.panelHint}><ShieldCheck size={14} /> 保留模式會讓好獎按節奏出現；「釋放尾聲獎」後，剩餘有限獎全部加入抽選。</p></section>
                <section className={styles.panel}><div className={styles.panelTitle}><div><span>現場入口</span><small>提供給學弟使用</small></div><ExternalLink size={16} color="var(--text-muted)" /></div><div className={styles.shareBox}><div><small>活動碼</small><strong>{selected.event_code}</strong></div><button type="button" onClick={() => void copy(selected.event_code, "活動碼已複製")}><Copy size={14} /></button></div><div className={styles.shareBox}><div><small>現場驗證碼</small><strong>{createdCodes[selected.id] ?? selected.access_code_hint}</strong></div>{createdCodes[selected.id] && <button type="button" onClick={() => void copy(createdCodes[selected.id], "驗證碼已複製")}><Copy size={14} /></button>}</div><div className={styles.shareUrl}><span>{typeof window === "undefined" ? "/raffle" : `${window.location.origin}/raffle`}</span><button type="button" onClick={() => void copy(`${window.location.origin}/raffle`, "抽獎網址已複製")}><Copy size={14} /></button></div><p className={styles.panelHint}><Lock size={14} /> 驗證成功後會固定在每台平板，不會因重新整理而跳回入口。</p></section>
              </div>

              <section className={styles.panel}><div className={styles.panelTitle}><div><span>最近抽獎</span><small>即時同步・最近 12 筆</small></div><button className={styles.iconButton} type="button" onClick={() => void load()}><RefreshCw size={14} /></button></div>{selected.recent_draws.length === 0 ? <div className={styles.noDraws}>活動開始後，這裡會顯示每一筆中獎結果。</div> : <div className={styles.drawTable}>{selected.recent_draws.map((draw) => <div className={styles.drawRow} key={draw.id}><span>#{String(draw.draw_number).padStart(3, "0")}</span><strong><b className={`${styles.tierMini} ${styles[`tier_${draw.prize_tier}`]}`}>{draw.prize_tier}</b>{draw.prize_name}</strong><time>{new Date(draw.created_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</time></div>)}</div>}</section>
            </>
          )}
          {selected && <button className={styles.newEventButton} type="button" onClick={() => setSelectedId(null)}><Plus size={15} /> 建立另一場活動</button>}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return <div className={styles.metric}><span className={`${styles.metricIcon} ${styles[`metric_${accent}`]}`}><Gauge size={16} /></span><div><small>{label}</small><strong>{value}<em>{note}</em></strong></div></div>;
}

function CreateForm({ form, setForm, onSubmit, busy }: { form: RaffleCreateInput; setForm: React.Dispatch<React.SetStateAction<RaffleCreateInput>>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const updatePrize = (index: number, patch: Partial<PrizeDraft>) => setForm((current) => ({ ...current, prizes: current.prizes.map((prize, prizeIndex) => prizeIndex === index ? { ...prize, ...patch } : prize) }));
  return <form className={styles.createPanel} onSubmit={onSubmit}><div className={styles.createIntro}><div className={styles.createIcon}><Sparkles size={20} /></div><div><span className={styles.statusBadge}>新活動</span><h2>建立一場現場抽獎</h2><p>預設獎品已依照你提供的 A／B／C／D 賞填好，可以直接開始。</p></div></div><div className={styles.formGrid}><label>活動碼<input value={form.event_code} onChange={(event) => setForm((current) => ({ ...current, event_code: event.target.value.toUpperCase() }))} /></label><label>現場驗證碼<input value={form.access_code} onChange={(event) => setForm((current) => ({ ...current, access_code: event.target.value }))} /></label><label className={styles.full}>活動名稱<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label><label className={styles.full}>給參加者看的說明<textarea value={form.description ?? ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label></div><div className={styles.formSectionTitle}><span>獎品與數量</span><small>D 賞數量留空代表無限</small></div><div className={styles.prizeEditor}>{form.prizes.map((prize, index) => <div className={styles.prizeEditRow} key={`${prize.tier}-${index}`}><select value={prize.tier} onChange={(event) => updatePrize(index, { tier: event.target.value })}><option>A</option><option>B</option><option>C</option><option>D</option></select><input value={prize.name} onChange={(event) => updatePrize(index, { name: event.target.value })} /><input type="number" min="0" placeholder="∞" value={prize.quantity ?? ""} disabled={prize.tier === "D"} onChange={(event) => updatePrize(index, { quantity: event.target.value === "" ? null : Number(event.target.value) })} /></div>)}</div><button className={styles.primaryCreate} type="submit" disabled={busy}><Sparkles size={17} /> {busy ? "建立中…" : "建立抽獎活動"}</button></form>;
}
